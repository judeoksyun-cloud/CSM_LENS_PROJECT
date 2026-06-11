@echo off
echo batch-starting > "C:\Users\user\Desktop\Codex_Practice\test-node-batch.log"
set PORT=8766
"C:\Program Files\nodejs\node.exe" -e "console.log(process.env.PORT)" >> "C:\Users\user\Desktop\Codex_Practice\test-node-batch.log" 2>&1
echo node-exited-%ERRORLEVEL% >> "C:\Users\user\Desktop\Codex_Practice\test-node-batch.log"
