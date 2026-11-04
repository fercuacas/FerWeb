# Prompts progresivos: ECC con Codex API e IA local

Preparados el **3 de noviembre de 2026** sobre el repositorio FerWeb. Son instrucciones para entregas futuras; no funciones ya implementadas.

## Cómo utilizarlos

1. Abre FerWeb en Codex y ejecuta un prompt completo cada vez, empezando por P00. Cada bloque incluye las reglas comunes para poder pegarlo en un chat nuevo.
2. Antes de avanzar, comprueba la evidencia del anterior. Una fase no está aceptada si sus comprobaciones requeridas no se pudieron ejecutar. Las dependencias forman un grafo; P09 y otras ramas pueden abordarse antes cuando sus requisitos estén listos.
3. El agente implementa y verifica solo esa entrega, conserva el trabajo existente y registra el resultado en progress.md. No crea commits, publica o llama modelos reales automáticamente.
4. P00 es documental. P01–P18 preparan y amplían el producto con Codex por API. P19–P21 incorporan IA local y comparación. P22–P26 amplían utilidades, automatización y operación; cada fase verifica sus dependencias reales.
5. Los prompts siguen siendo válidos si el repositorio evoluciona: el agente debe comprobar rutas y contratos, no sobreescribir una implementación mejor o duplicar módulos existentes.

Puedes usar los archivos individuales o [todos los prompts reunidos](PROMPTS.md). [Base revisada y decisiones](BASELINE.md), [matriz de cobertura](coverage.md) y [registro inicial de progreso](progress.md).

## Decisión central de arquitectura

FerWeb ya usa **Codex CLI en un contenedor separado, autenticado por API y conectado mediante una pasarela Responses**. Esa es la primera ruta que se conserva. La Agents API gestionada de OpenAI es una integración distinta; no se requiere migrar todo el producto a ella para cumplir este plan.

Se separan **rol y skills → workflow → runtime → proveedor de inferencia → herramientas y política de ejecución**. La persistencia y autorización permanecen en FerWeb. Así se podrá usar Codex con un proveedor local compatible o un ejecutor local distinto, sin rehacer tareas, memoria, equipos e informes. Las capacidades se prueban por combinación de versión/modelo; se rechaza lo no compatible y no hay fallback externo silencioso.

La documentación oficial contempla [Codex con proveedores locales OSS](https://learn.chatgpt.com/docs/config-file/config-advanced) y explica la [Agents API gestionada](https://developers.openai.com/api/docs/guides/agents-api/overview). Estas referencias deben verificarse de nuevo contra la versión concreta al implementar; no certifican que todos los modelos locales puedan usar herramientas ni que un sandbox local implique inferencia local.

## Qué significa cubrir ECC

Se cubren sus familias de agentes, skills, reglas, contexto, comandos, coordinación, memoria, aprendizaje, revisión, evaluación, herramientas, paneles, GitHub, extensiones y operación. Los paquetes de dominios se integran como contenido/workflows o adaptadores con estados explícitos. Una skill que utiliza un servicio externo no equivale a reconstruir ese servicio dentro de FerWeb.

Pagos, correo externo, publicación social, GPU, herramientas sanitarias o financieras y otros servicios no se activan por importar su catálogo. Su disponibilidad depende de adaptador, configuración, permisos y aceptación específica; se conserva una fila pendiente en vez de inventar un resultado. Las copias traducidas/generadas no cuentan como nuevas utilidades.

## Secuencia de entregas

| Prompt | Resultado principal | Dependencias |
|---|---|---|
| [P00](P00-baseline.md) | Base y contrato de evolución | Ninguna |
| [P01](P01-capabilities.md) | Proveedores, ejecutores y capacidades | P00 |
| [P02](P02-agents.md) | Catálogo versionado de agentes | P01 |
| [P03](P03-skills.md) | Biblioteca de skills, reglas y contexto | P01, P02 |
| [P04](P04-budgets.md) | Presupuesto compartido y contabilidad | P01, P02 |
| [P05](P05-teams.md) | Equipos y plantillas de workflow | P02, P03, P04 |
| [P06](P06-sequential.md) | Ejecución duradera de un equipo secuencial | P04, P05 |
| [P07](P07-parallel.md) | Especialistas en paralelo y mensajes | P06 |
| [P08](P08-reviews.md) | Revisión por dimensiones y verificación | P07 |
| [P09](P09-memory.md) | Memoria de proyecto y entregas portables | P06 |
| [P10](P10-context.md) | Selección de skills y contexto con recibos | P03, P09 |
| [P11](P11-tool-profiles.md) | Herramientas y verificación por perfil | P01, P06 |
| [P12](P12-gates.md) | Hooks y controles de calidad verificables | P08, P11 |
| [P13](P13-evaluation.md) | Evaluación de agentes, equipos y contexto | P08, P10, P11 |
| [P14](P14-learning.md) | Lecciones, cumplimiento y evolución revisada | P09, P13 |
| [P15](P15-commands.md) | Comandos y recetas de trabajo | P05, P08, P12 |
| [P16](P16-control-room.md) | Centro de control y revisión visual | P06, P08, P09, P15 |
| [P17](P17-writers.md) | Varios escritores e integración de cambios | P07, P08, P11, P16 |
| [P18](P18-github.md) | Épicas, dependencias y coordinación GitHub | P05, P08, P16 |
| [P19](P19-local-analysis.md) | IA local para especialistas de lectura | P01, P07, P10, P13 |
| [P20](P20-local-coding.md) | Ejecutor de código con IA local | P11, P12, P13, P19 |
| [P21](P21-routing.md) | Comparación API/local y selección por reglas | P13, P19, P20 |
| [P22](P22-extensions.md) | Extensiones, conectores e interoperabilidad | P03, P11, P12, P21 |
| [P23](P23-utility-packs.md) | Paquetes de utilidades y cobertura del catálogo ECC | P03, P15, P22 |
| [P24](P24-automations.md) | Automatizaciones, recuperación y notificaciones | P06, P16, P21, P22 |
| [P25](P25-operations.md) | Observabilidad, copias y operación | P16, P20, P24 |
| [P26](P26-acceptance.md) | Auditoría de cobertura y aceptación final | P00–P25 según capacidades habilitadas |

## Revisión de la web utilizada

La URL local no estaba accesible y Docker Desktop Linux no estaba arrancado. El usuario indicó continuar con el repositorio. Se revisaron las pantallas/componentes React y sus contratos; no se declara una inspección visual autenticada ni pruebas de navegador ejecutadas en esta preparación. No se han arrancado servicios para redactar los prompts.

La navegación actual por proyecto contiene Tareas, Repositorio GitHub, Conversaciones, Laboratorio y Trabajos; Agentes figura como Pronto. El plan integra capacidades en esas superficies antes de añadir nuevas vistas cuando sean necesarias. [Base detallada](BASELINE.md).

## Fuentes y límites

ECC analizado: [commit b38be6a7](https://github.com/affaan-m/ECC/tree/b38be6a7f6350964d59328b52f0624e1d1d552d1), paquete fuente 2.2.3, 4.701 archivos versionados, 314 skills principales, 71 agentes y 98 comandos. El análisis distingue código, guías, pilotos, diseños y adaptadores externos. No es una certificación de seguridad ni una afirmación de que todos sus programas se han ejecutado.

La disponibilidad actual de FerWeb se consulta en [estado](../../status.md); las reglas de validación en [desarrollo](../../development.md). No se han modificado esos documentos para anunciar la ejecución de este plan. Al reutilizar porciones de ECC hay que conservar avisos/licencia y revisar dependencias de terceros.
