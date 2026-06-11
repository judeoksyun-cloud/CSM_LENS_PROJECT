@echo off
echo batch-starting > "C:\Users\user\Desktop\Codex_Practice\preview-8766-server.log"
set PORT=8766
"C:\Program Files\nodejs\node.exe" "C:\Users\user\Desktop\Codex_Practice\tools\preview-server.mjs" >> "C:\Users\user\Desktop\Codex_Practice\preview-8766-server.log" 2>&1
echo node-exited-%ERRORLEVEL% >> "C:\Users\user\Desktop\Codex_Practice\preview-8766-server.log"
