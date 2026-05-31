# STRICT RULES FOR AI AGENTS

**CRITICAL WARNING TO ALL AI ASSISTANTS, AGENTS, AND LLMs WORKING IN THIS WORKSPACE:**

1. **NEVER DELETE OR OVERWRITE LARGE FILES WHOLESALE:** 
   Do NOT completely replace massive files (like `Studio.jsx` or any file over 500 lines) with a thin wrapper or completely new shell. If the user asks for refactoring, you MUST do it surgically (e.g., extracting components while leaving global state, imports, and handlers intact).

2. **NEVER RUN DESTRUCTIVE GIT COMMANDS WITHOUT EXPLICIT PERMISSION:**
   Do NOT run `git checkout`, `git restore`, `git clean`, or `git reset --hard` without FIRST asking the user and explicitly warning them that uncommitted work will be permanently lost.

3. **NEVER ASSUME CODE IS EXPENDABLE:**
   Do not remove "unused" or "testing" infrastructure if it contains actual business logic, upload handlers, or complex UI shells (like sidebars and navbars) unless you are 100% sure it is safe.

4. **WHEN IN DOUBT, ASK!**
   If you are about to make a change that affects more than 100 lines of code, STOP and ask the user for confirmation first. Do not make unilateral architectural decisions that could break the runtime.

By reading this file, you are bound by these constraints. Failure to adhere to them will result in catastrophic data loss for the user.
