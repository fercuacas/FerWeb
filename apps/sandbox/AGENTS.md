# Imagen y procesos de código

Lee [codex.md](../../docs/codex.md); reglas de `apps/runner/` si cambia creación/recogida del contenedor.

- Codex CLI fijado, workspace por tarea, UID/GID 1000 sin capacidades para agente/código/tests. Supervisor root con capacidades mínimas para lanzar ese usuario y vigilar lease/plazo.
- Sin socket Docker, credenciales generales, token/fence de control o montajes del anfitrión. Raíz de lectura, red `none`, temporales/recursos acotados y watchdog independiente del worker.
- No cargues configuración/AGENTS/MCP del repositorio para ampliar permisos. No habilites red, multiagente o instalación de dependencias para resolver un test.
- Recolector sin ejecutar archivos del workspace: lectura acotada, UTF-8 regular, sin enlaces/especiales. Recogida incompleta no significa ausencia de cambios.

Verifica límites y parada desde el proceso sin privilegios. Fixtures en `tests/fixtures/coding-repo/`; recetas en [desarrollo](../../docs/development.md).
