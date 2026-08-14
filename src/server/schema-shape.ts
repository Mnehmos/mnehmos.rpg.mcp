/**
 * Return the object shape represented by a Zod schema, including intersections.
 * MCP registration needs a plain shape even when a tool schema was composed
 * with `.and()` or `z.intersection()`.
 */
export function schemaShape(schema: any): Record<string, any> {
    if (!schema) return {};
    if (schema.shape) {
        return typeof schema.shape === 'function' ? schema.shape() : schema.shape;
    }

    const definition = schema._def;
    if (definition?.shape) {
        return typeof definition.shape === 'function' ? definition.shape() : definition.shape;
    }
    if (definition?.left && definition?.right) {
        return {
            ...schemaShape(definition.left),
            ...schemaShape(definition.right)
        };
    }
    if (definition?.schema) return schemaShape(definition.schema);
    return {};
}
