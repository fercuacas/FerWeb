# Extensiones y catálogo portable (P22)

## Configurar un conector de lectura

1. En **Agentes → Extensiones del proyecto**, usa **Importar lector de ejemplo** o carga el [manifiesto JSON de ejemplo](extension.example.json). La importación registra una versión y la deja inactiva. La vista del manifiesto muestra procedencia, licencia, dependencia, recursos y huella.
2. Elige un recurso declarado y guarda la configuración. Revisa la previsualización con los archivos que se incorporan, actualizan, conservan u ocultan. Marca la revisión del origen, los recursos y el destino local y pulsa **Aprobar configuración**.
3. Usa **Habilitar extensión** para aplicar esa copia. **Ejecutar lectura local** abre el único recurso configurado y deja un recibo. La acción tiene un identificador idempotente. Repetir una operación registrada recupera el recibo original durante la vida activa del proyecto.
4. Para actualizar, importa otra versión del mismo `slug`. La configuración y aprobación anteriores caducan. Selecciona una versión conservada y vuelve a configurar, revisar y habilitar para revertir. **Previsualizar retirada** muestra qué recursos gestionados quedarán ocultos y qué ediciones permanecen visibles.

Los recursos se guardan en un espacio propio de la extensión en PostgreSQL. **Editar copia del proyecto** cambia la propiedad a `project` y cancela la aprobación. Si se modifica el recurso configurado, elige otro recurso gestionado para volver a habilitar la lectura. Actualizar, revertir o retirar conserva las ediciones del proyecto. La retirada oculta los recursos gestionados y conserva las versiones y el historial de lectura. En un proyecto archivado siguen disponibles la consulta y exportación autorizadas.

La migración 030 añade versiones, recursos e historial. El servidor serializa cambios por proyecto y exige la revisión vigente y la huella de la vista previa al revisar, habilitar o retirar. Reimportar la misma versión y contenido es idempotente. Registrar contenido distinto requiere otro número de versión.

## Manifiesto y frontera del conector

El formato 1 declara identidad, versión exacta, origen, licencia, recursos, capacidades, dependencias y destinos. Cada recurso incluye ruta relativa, texto UTF-8 y SHA-256. Las rutas usan un subconjunto portable en minúscula con extensiones `.md`, `.txt` o `.json`. El origen GitHub usa repositorio, commit completo y ruta informativa. FerWeb nunca resuelve la referencia para importar. Solo acepta la dependencia del lector incorporado `fixture-reader` 1.0.0 y el destino `project-local`.

El lector es una operación fija que recibe el recurso aprobado y devuelve su texto al propietario del proyecto. Carece de transporte, credenciales y acceso a archivos del anfitrión. El manifiesto y la configuración rechazan URLs de transporte, rutas de escape, comandos, dependencias mutables, credenciales y destinos externos. Así no existe una ruta de petición saliente que una importación pueda controlar. La carpeta del proyecto, `.codex`, el archivo de configuración del anfitrión y el sandbox de Codex mantienen sus controles existentes. Las utilidades externas con MCP, scripts o red siguen fuera de este recorrido.

## Exportar roles, skills y workflows

Abre **Agentes → Exportar catálogo portable** y elige un rol, una skill de texto aprobada o una versión de plantilla. La plantilla incluye sus roles exactos y sus skills vinculadas. La previsualización enumera archivos y huellas. Las descargas vuelven a validar acceso y la misma huella.

- **Catálogo JSON** usa `ferweb-portable-v1` con roles, skills y workflow opcional. Conserva identificadores, versiones, requisitos, licencias y referencias. Los resultados de tareas, historiales de conversación y credenciales quedan fuera del catálogo.
- **Archivos para Codex** entrega un ZIP con el catálogo, una guía breve, roles TOML en `.codex/agents` y skills en `.agents/skills`. Los recursos de cada skill conservan texto y licencias. El workflow describe etapas y requisitos para el operador. Su ejecución, permisos y presupuesto se configurarían en el entorno de destino. [Roles de Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents) y [skills de Codex](https://learn.chatgpt.com/docs/build-skills).

Extrae el ZIP en un directorio vacío. Revisa los archivos antes de incorporarlos a un proyecto Codex. El exportador crea rutas generadas y solo usa `name`, `description` y `developer_instructions` en los roles. Los modelos, servidores MCP y permisos dependen del entorno que consuma esos archivos. La sintaxis TOML y el contenido del ZIP se verifican con un lector estándar. La aceptación con un destino real y las extensiones de terceros quedan pendientes de una selección explícita.
