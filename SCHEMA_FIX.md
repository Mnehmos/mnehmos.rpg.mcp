# Quick Fix for REMOVE_CUSTOM_EFFECT Schema Error

## Problem
Line 238 in `src/server/index.ts` tries to call `.extend()` on `ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema`, but the schema has `.refine()` applied to it, which returns a ZodEffects object that doesn't have an `.extend()` method.

## Solution
Remove the `.refine()` call from the REMOVE_CUSTOM_EFFECT schema definition, and move the validation to the handler function instead.

## File: src/server/improvisation-tools.ts

Find this code (around line 216):

```typescript
REMOVE_CUSTOM_EFFECT: {
    name: 'remove_custom_effect',
    description: 'Remove a custom effect by ID or by name.',
    inputSchema: z.object({
        effect_id: z.number().int().optional(),
        target_id: z.string().optional(),
        target_type: z.enum(['character', 'npc']).optional(),
        effect_name: z.string().optional()
    }).refine(
        data => data.effect_id !== undefined || (data.target_id && data.target_type && data.effect_name),
        { message: 'Must provide either effect_id or (target_id, target_type, effect_name)' }
    )
},
```

Replace with:

```typescript
REMOVE_CUSTOM_EFFECT: {
    name: 'remove_custom_effect',
    description: 'Remove a custom effect by ID or by name.',
    inputSchema: z.object({
        effect_id: z.number().int().optional(),
        target_id: z.string().optional(),
        target_type: z.enum(['character', 'npc']).optional(),
        effect_name: z.string().optional()
    })
},
```

Then add validation to the handler function `handleRemoveCustomEffect` (around line 673):

```typescript
export async function handleRemoveCustomEffect(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema.parse(args);
    
    // Add validation here
    if (parsed.effect_id === undefined && 
        !(parsed.target_id && parsed.target_type && parsed.effect_name)) {
        throw new Error('Must provide either effect_id or (target_id, target_type, effect_name)');
    }
    
    const { effectsRepo } = ensureDb();
    // ... rest of the function
}
```

## Alternative: Use merge() instead of extend()

If you want to keep the .refine(), you can change how the sessionId is added in index.ts.

Find line 238 in `src/server/index.ts`:

```typescript
ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
```

Replace with:

```typescript
ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema.and(z.object({ sessionId: z.string().optional() })),
```

OR use merge:

```typescript
ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema.merge(z.object({ sessionId: z.string().optional() })),
```

However, neither `.and()` nor `.merge()` work with `.shape`, so you'd need to remove `.shape` as well.

## Recommended Quick Fix

The absolute quickest fix is to just remove the `.shape` part from line 238 in index.ts:

Change this:
```typescript
ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema.extend({ sessionId: z.string().optional() }).shape,
```

To this (just remove the whole extend call since sessionId is optional anyway):
```typescript
ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema,
```
