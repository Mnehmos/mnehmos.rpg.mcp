import { z } from 'zod';
import { SessionContext } from './types.js';
import { getDb } from '../storage/index.js';
import { SecretRepository } from '../storage/repos/secret.repo.js';

// Schemas
export const GetNarrativeContextSchema = z.object({
  worldId: z.string().describe('Active world ID'),
  characterId: z.string().optional().describe('Active character ID (if any)'),
  encounterId: z.string().optional().describe('Active encounter ID (if any)'),
  maxEvents: z.number().default(5).describe('Number of recent history events to include')
});

export const ContextTools = {
  GET_NARRATIVE_CONTEXT: {
    name: 'get_narrative_context',
    description: 'Aggregates comprehensive narrative context (Character, World, Combat, Secrets) for the LLM system prompt.',
    inputSchema: GetNarrativeContextSchema
  }
} as const;

// Types helpers
interface NarrativeSection {
  title: string;
  content: string;
  priority: number; // Higher means closer to the top/more important
}

// Handler
export async function handleGetNarrativeContext(args: unknown, _ctx: SessionContext) {
  const parsed = ContextTools.GET_NARRATIVE_CONTEXT.inputSchema.parse(args);
  const db = getDb(process.env.RPG_DATA_DIR ? `${process.env.RPG_DATA_DIR}/rpg.db` : 'rpg.db');
  
  const sections: NarrativeSection[] = [];

  // 1. World & Environment (Baseline)
  try {
    const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(parsed.worldId) as any;
    if (world) {
      let envContext = `Active World: ${world.name}`;
      
      const env = typeof world.environment === 'string' ? JSON.parse(world.environment) : world.environment;
      if (env) {
        const parts = [
          env.date ? `Date: ${env.date.full_date || env.date}` : null,
          env.time_of_day ? `Time: ${env.time_of_day}` : null,
          env.weather ? `Weather: ${env.weather.condition || env.weather}` : null,
          env.location ? `Location: ${env.location}` : null
        ].filter(Boolean);
        
        if (parts.length > 0) {
          envContext += `\n${parts.join(' | ')}`;
        }
      }
      
      sections.push({
        title: '🌍 WORLD & ENVIRONMENT',
        content: envContext,
        priority: 10
      });
    }
  } catch (e) {
    console.warn('Failed to load world context', e);
  }

  // 2. Character State (If active)
  if (parsed.characterId) {
    try {
      const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(parsed.characterId) as any;
      if (char) {
        const hp = typeof char.hp === 'string' ? JSON.parse(char.hp) : char.hp;
        const stats = typeof char.stats === 'string' ? JSON.parse(char.stats) : char.stats;
        
        let charSummaries = ` Active Character: ${char.name} (Lvl ${char.level} ${char.race} ${char.class})`;
        charSummaries += `\nHP: ${hp.current}/${hp.max} | AC: ${char.ac || 10}`;
        if (stats) {
            charSummaries += `\nSTR:${stats.str} DEX:${stats.dex} CON:${stats.con} INT:${stats.int} WIS:${stats.wis} CHA:${stats.cha}`;
        }
        
        sections.push({
            title: '👤 ACTIVE CHARACTER',
            content: charSummaries,
            priority: 20
        });
      }
    } catch (e) {
      console.warn('Failed to load character context', e);
    }
  }

  // 3. Combat State (High Priority)
  if (parsed.encounterId) {
    try {
        const encounter = db.prepare('SELECT * FROM encounters WHERE id = ?').get(parsed.encounterId) as any;
        if (encounter && encounter.status === 'active') {
            const state = typeof encounter.state === 'string' ? JSON.parse(encounter.state) : encounter.state;
            
            let combatSummary = `⚠️ COMBAT ACTIVE (Round ${state.round})`;
            
            const participants = state.participants || [];
            const activeCount = participants.filter((p: any) => p.hp > 0).length;
            
            combatSummary += `\n${activeCount} active combatants.`;
            if (state.currentTurn !== undefined && participants[state.currentTurn]) {
                combatSummary += `\nCurrent Turn: ${participants[state.currentTurn].name}`;
            }

            sections.push({
                title: '⚔️ COMBAT SITUATION',
                content: combatSummary,
                priority: 100 // Highest priority
            });
        }
    } catch (e) {
        console.warn('Failed to load combat context', e);
    }
  }

  // 4. Secrets (GM Only - Highest)
  try {
    const secretRepo = new SecretRepository(db);
    const secretParams = secretRepo.formatForLLM(parsed.worldId);
    if (secretParams && secretParams.length > 50) { // arbitrary length check for "empty" text
        sections.push({
            title: '🔒 GM SECRETS (HIDDEN)',
            content: secretParams,
            priority: 90
        });
    }
  } catch (e) {
    console.warn('Failed to load secret context', e);
  }

  // Optimize & Format
  sections.sort((a, b) => b.priority - a.priority);

  const finalContext = sections.map(s => `--- ${s.title} ---\n${s.content}`).join('\n\n');

  return {
    content: [{
      type: 'text' as const,
      text: finalContext
    }]
  };
}
