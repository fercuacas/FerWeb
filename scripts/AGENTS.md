# Operación y verificaciones

Lee [docker.md](../docs/docker.md) para operación, [desarrollo](../docs/development.md) para pruebas y la sección CA del README solo si cambia construcción/TLS.

- `docker.mjs` gestiona Compose, CA/configuración privada. Mantén secretos fuera de argumentos/logs/build contexts y TLS verificado. No imprimas `compose config` con valores reales.
- `setup.mjs` conserva `.env`/contraseñas y genera solo lo que falte, sin imprimirlo. Arrancar no reprovisiona al propietario.
- Base activa en volumen Docker; `.local/postgres-data` y dumps son respaldos. No uses `down --volumes` para reiniciar/probar la aplicación.
- Fixtures y bases/colecciones/volúmenes propios se limpian en `finally`; no interfieras con otra validación. Conserva aislamiento Compose y preparación por salud.
- Sin servidores nativos salvo recuperación pedida ni publicación/túneles como efecto de tests.

Verifica el comando cambiado con recursos propios; YAML válido no equivale a arranque comprobado.
