# Worker Plan
# How to run this (for the main agent)
- The main session runs on Fable. If you are not Fable, tell the user to type /model fable.
- Fable never writes project files itself. For each file, start an Agent with model "opus" and give it the file, the contract fields and the checks it must pass.
- Small edits go to an Agent with model "sonnet".
- After each file, Fable checks it against feature_expectation.md and sends mistakes back to Opus.
- Grill the user on files 7, 8, 9 and 11 (or: on every file).
After each loop, fable checks with feature_expectation.md, if any problems arises fable remprompts to opus about his mistakes to solve the issue.

# Major architectural design
Any major architectural design is to be asked to user and cross check wehther the user's intentions is fully understood. Ask any questions needed regarding that and if any plan clashes with architecture.md file, then alert me.

# project-work
After every component of the project is done, change the progress.md to reflect what part is done. How much yet left in percentage. 

# Keep it simple
16-hour hackathon. Build only what plan/ and feature_expectation.md ask for.
No extra abstractions, config options, or libraries. Smallest change that passes the checks.

# MUST CONSIDER
Fable must follow the memory-bank and plan while taking decisions.
Dont change anything in memory-bank and plan except progress.md. Any change is strictly forbidden

# Dumb down
After finishing a file, explain every single line of code as if I only understand the content in dumb-down.md and beside that I have no technical knowledge
