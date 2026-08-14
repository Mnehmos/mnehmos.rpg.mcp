## ADR-001: Unified Tool Contract Object Model

### Status
Accepted

### Context
The consolidated runtime currently keeps key contract elements in separate places:
- Tool metadata maps in `src/server/consolidated-registry.ts`
- Action enums and schemas in `src/server/consolidated/*.ts`
- Handler bindings in consolidated tool modules

This separation creates drift risk between discovery metadata, runtime behavior, and documentation.

### Decision
Adopt a **single declarative contract object per consolidated tool** that contains:
1. Tool metadata (name/category/keywords/capabilities/description)
2. Action definitions (action literals + schemas)
3. Handler bindings

Generate registry/search metadata from these contract objects, replacing manually maintained parallel maps where possible.

### Consequences
**Positive**
- Stronger consistency across registration, schema loading, and discovery
- Lower maintenance overhead for adding/modifying tools
- Easier automated documentation and parity checks

**Trade-offs**
- Initial migration cost for all consolidated tools
- Requires generator/adapter layer for current runtime registration path

### Acceptance Criteria
- [x] Each consolidated tool is represented by one `ToolContract` definition
- [x] Registry metadata is derived from contract definitions
- [x] `search_tools` and `load_tool_schema` behavior remains compatible
- [x] Tests verify metadata/action/schema parity for all consolidated tools

### Source
Architecture analysis: `docs/ARCHITECTURE-CODEBASE-ANALYSIS.md`
