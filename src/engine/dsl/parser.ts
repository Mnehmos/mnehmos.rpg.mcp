import { PatchCommand, PatchCommandSchema } from './schema.js';

/**
 * Parse a DSL script into a list of commands.
 * 
 * Syntax:
 * COMMAND key=value key2="string value"
 * 
 * - Lines starting with # are comments
 * - Empty lines are ignored
 * - Keys and values are separated by =
 * - String values with spaces must be quoted
 */
export function parseDSL(script: string): PatchCommand[] {
    const lines = script.split('\n');
    const commands: PatchCommand[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip empty lines and comments
        if (!line || line.startsWith('#')) {
            continue;
        }

        try {
            const command = parseLine(line);
            commands.push(command);
        } catch (error: any) {
            throw new Error(`Error on line ${i + 1}: ${error.message}`);
        }
    }

    return commands;
}

function parseLine(line: string): PatchCommand {
    // Split by spaces, but respect quotes
    // Regex: Match key="value" (quoted) OR key=value (unquoted) OR "quoted value" OR simple tokens
    const tokens = line.match(/[a-zA-Z0-9_]+=(?:"[^"]*"|\S+)|"[^"]*"|\S+/g) || [];

    if (tokens.length === 0) {
        throw new Error('Empty command');
    }

    const commandName = tokens[0];
    const args: Record<string, string> = {};

    // Check for positional arguments (no '=' in first arg)
    if (tokens.length > 1 && !tokens[1].includes('=')) {
        if (commandName === 'ADD_STRUCTURE' && tokens.length >= 4) {
            // ADD_STRUCTURE type x y [name]
            args['type'] = tokens[1];
            args['x'] = tokens[2];
            args['y'] = tokens[3];
            if (tokens.length > 4) {
                let name = tokens[4];
                if (name.startsWith('"') && name.endsWith('"')) {
                    name = name.slice(1, -1);
                }
                args['name'] = name;
            } else {
                // Default name to type if not provided (to satisfy schema if needed, though schema requires name)
                // The schema requires name, but the plan said "default name to type".
                // Let's check schema: name: z.string().min(1, 'Name cannot be empty')
                // So we should provide a default if missing.
                args['name'] = tokens[1];
            }
        } else if (commandName === 'SET_BIOME' && tokens.length >= 4) {
            // SET_BIOME type x y (Note: docs say type x y, but schema has x y type. Let's support type x y as per plan/docs)
            // Plan: SET_BIOME type x y
            // Schema: x, y, type
            args['type'] = tokens[1];
            args['x'] = tokens[2];
            args['y'] = tokens[3];
        } else if (commandName === 'EDIT_TILE' && tokens.length >= 4) {
            // EDIT_TILE x y elevation
            args['x'] = tokens[1];
            args['y'] = tokens[2];
            args['elevation'] = tokens[3];
        } else {
            // Fallback or error?
            // If it's not a known positional command, maybe throw error or try to parse as is?
            // But if it doesn't have '=', the loop below will throw "Invalid argument format".
            // So we can just let it fall through to the loop if we don't match above.
        }
    }

    // If we parsed positional args, we skip the loop.
    // But we need to know if we did.
    const hasPositionalArgs = Object.keys(args).length > 0;

    if (!hasPositionalArgs) {
        for (let i = 1; i < tokens.length; i++) {
            const token = tokens[i];
            const eqIndex = token.indexOf('=');

            if (eqIndex === -1) {
                throw new Error(`Invalid argument format: ${token}. Expected key=value`);
            }

            const key = token.substring(0, eqIndex);
            let value = token.substring(eqIndex + 1);

            // Remove quotes if present
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }

            args[key] = value;
        }
    }

    // Validate against schema
    // We construct a raw object first, then let Zod handle coercion and validation
    const rawCommand = {
        command: commandName,
        args: args
    };

    const result = PatchCommandSchema.safeParse(rawCommand);

    if (!result.success) {
        const errorMessages = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new Error(`Invalid command arguments: ${errorMessages}`);
    }

    return result.data;
}
