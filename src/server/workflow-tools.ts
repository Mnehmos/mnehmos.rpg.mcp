/**
 * Workflow Tools
 * 
 * MCP tools for executing workflows and managing templates.
 */
import { z } from 'zod';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'yaml';
import { WorkflowSchema, Workflow } from '../workflow/schema.js';
import { WorkflowExecutor } from '../workflow/executor.js';
import { SessionContext } from './types.js';

// ESM-compatible __dirname (works in both dev and bundled)
let __dirnameCompat: string;
try {
  // This works in normal ESM but throws in pkg binary
  __dirnameCompat = dirname(fileURLToPath(import.meta.url));
} catch {
  // In pkg binary, fall back to process.cwd()
  __dirnameCompat = process.cwd();
}

// Templates directory resolution
function getTemplatesDir(): string {
  const candidates = [
    join(process.cwd(), 'templates', 'workflows'),
    join(__dirnameCompat, '..', '..', 'templates', 'workflows'),
    join(__dirnameCompat, 'templates', 'workflows'),
  ];
  
  for (const dir of candidates) {
    if (existsSync(dir)) {
      return dir;
    }
  }
  
  return candidates[0]; // Graceful fallback
}

const TEMPLATES_DIR = getTemplatesDir();

// Tool definitions
export const WorkflowTools = {
  EXECUTE_WORKFLOW: {
    name: 'execute_workflow',
    description: `Execute a workflow from a template or inline definition.

Workflows automate multi-step operations like creating a full party, setting up an encounter, or populating a village.

Example - Execute starter_party template:
{
  "template": "starter_party",
  "params": {
    "partyName": "The Brave Ones"
  }
}

Example - Execute inline workflow:
{
  "workflow": {
    "name": "Quick Fight",
    "description": "Setup a quick goblin fight",
    "steps": [
      {
        "name": "create_goblins",
        "tool": "batch_create_characters",
        "params": {
          "characters": [
            { "name": "Goblin 1", "characterType": "enemy" },
            { "name": "Goblin 2", "characterType": "enemy" }
          ]
        }
      }
    ]
  }
}`,
    inputSchema: z.object({
      template: z.string().optional().describe('Name of template file (without .yaml)'),
      workflow: WorkflowSchema.optional().describe('Inline workflow definition'),
      params: z.record(z.any()).optional().describe('Parameters to pass to the workflow')
    }).refine(
      data => data.template || data.workflow,
      { message: 'Either template or workflow must be provided' }
    )
  },

  LIST_TEMPLATES: {
    name: 'list_templates',
    description: `List all available workflow templates.

Returns template names, descriptions, and required parameters.`,
    inputSchema: z.object({
      category: z.string().optional().describe('Filter by category')
    })
  },

  GET_TEMPLATE: {
    name: 'get_template',
    description: `Get details of a specific workflow template including full schema and parameters.`,
    inputSchema: z.object({
      name: z.string().describe('Template name (without .yaml)')
    })
  }
} as const;

// Handlers

export async function handleExecuteWorkflow(args: unknown, ctx: SessionContext) {
  const parsed = WorkflowTools.EXECUTE_WORKFLOW.inputSchema.parse(args);
  
  let workflow: Workflow;
  
  if (parsed.template) {
    // Load from template file
    const templatePath = join(TEMPLATES_DIR, `${parsed.template}.yaml`);
    if (!existsSync(templatePath)) {
      throw new Error(`Template not found: ${parsed.template}`);
    }
    
    const content = readFileSync(templatePath, 'utf-8');
    const raw = yaml.parse(content);
    workflow = WorkflowSchema.parse(raw);
  } else if (parsed.workflow) {
    workflow = parsed.workflow;
  } else {
    throw new Error('Either template or workflow must be provided');
  }
  
  // Execute workflow
  const executor = new WorkflowExecutor(ctx);
  const result = await executor.execute(workflow, parsed.params || {});
  
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(result, null, 2)
    }]
  };
}

export async function handleListTemplates(args: unknown, _ctx: SessionContext) {
  WorkflowTools.LIST_TEMPLATES.inputSchema.parse(args);
  
  const templates: any[] = [];
  
  if (!existsSync(TEMPLATES_DIR)) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          templates: [],
          message: 'No templates directory found'
        }, null, 2)
      }]
    };
  }
  
  const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.yaml'));
  
  for (const file of files) {
    try {
      const content = readFileSync(join(TEMPLATES_DIR, file), 'utf-8');
      const raw = yaml.parse(content);
      
      templates.push({
        name: file.replace('.yaml', ''),
        description: raw.description || '',
        version: raw.version || '1.0.0',
        author: raw.author,
        parameters: raw.parameters ? Object.keys(raw.parameters) : [],
        stepCount: raw.steps?.length || 0
      });
    } catch {
      // Skip invalid files
    }
  }
  
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        templates,
        count: templates.length
      }, null, 2)
    }]
  };
}

export async function handleGetTemplate(args: unknown, _ctx: SessionContext) {
  const parsed = WorkflowTools.GET_TEMPLATE.inputSchema.parse(args);
  
  const templatePath = join(TEMPLATES_DIR, `${parsed.name}.yaml`);
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${parsed.name}`);
  }
  
  const content = readFileSync(templatePath, 'utf-8');
  const raw = yaml.parse(content);
  const workflow = WorkflowSchema.parse(raw);
  
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        author: workflow.author,
        parameters: workflow.parameters,
        steps: workflow.steps.map(s => ({
          name: s.name,
          tool: s.tool,
          dependsOn: s.dependsOn
        })),
        output: workflow.output
      }, null, 2)
    }]
  };
}
