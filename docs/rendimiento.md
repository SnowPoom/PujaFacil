# Evaluación de rendimiento

## Fecha y entorno

- **Fecha:** 16/11/2026.
- **Aplicación:** Next.js 16.4.6 ejecutado localmente.
- **Base de datos:** PostgreSQL en Docker.
- **Herramienta de medición:** Google Chrome, Lighthouse 13.5.0 (DevTools).
- **Configuración de Lighthouse:** escritorio emulado, carga inicial de página, sesión de una sola página y *custom throttling*.

## Escenario probado

Consulta paginada del catálogo público mediante `GET /api/public/articles`, con `pageSize=8`, y renderizado de la página principal `/`.

Las métricas de Lighthouse corresponden a la carga de la página mostrada en las capturas. La captura adicional de DevTools → Network → Timing aporta la duración observada de la solicitud del endpoint.

## Métricas obtenidas

| Métrica | Valor medido | Fuente |
|---|---:|---|
| Performance | **93/100** | Lighthouse |
| First Contentful Paint (FCP) | **0.4 s** | Lighthouse |
| Largest Contentful Paint (LCP) | **0.5 s** | Lighthouse |
| Tiempo total de `GET /api/public/articles` | **1.16 s** | DevTools → Network → Timing |
| Espera de respuesta del servidor (TTFB) | **897.75 ms** | DevTools → Network → Timing |

### Métricas complementarias de Lighthouse

| Métrica | Valor medido |
|---|---:|
| Total Blocking Time (TBT) | 40 ms |
| Cumulative Layout Shift (CLS) | 0.16 |
| Speed Index | 0.7 s |

### Desglose de la solicitud HTTP (DevTools)

| Fase | Duración |
|---|---:|
| Queueing | 11.40 ms |
| Stalled | 250.06 ms |
| Request sent | 0.17 ms |
| Waiting for server response (TTFB) | 897.75 ms |
| Content download | 2.73 ms |
| **Total mostrado por DevTools** | **1.16 s** |

La duración total incluye esperas y transferencia; el TTFB no equivale al tiempo exclusivo de ejecución de la consulta en PostgreSQL. Los valores individuales pueden diferir ligeramente del total mostrado por redondeo.

## Optimización aplicada

1. **Paginación en servidor:** uso de `skip` y `take`, con `pageSize=8`, para limitar los artículos recuperados en cada consulta y evitar cargar todo el catálogo en memoria.
2. **Índices en PostgreSQL:** índices sobre `Article(title)` y `Article(category, status)` para apoyar los accesos por esos campos. La búsqueda actual usa coincidencia parcial sin distinguir mayúsculas; no se ha demostrado con EXPLAIN que aproveche el índice de título para todos los términos.

## Observaciones

La puntuación de Performance obtenida fue **93/100**. Los valores anteriores son los observados en las capturas de Lighthouse del **16/11/2026**; no constituyen una comparación antes/después de las optimizaciones. El tiempo total del endpoint registrado en Network fue **1.16 s**. Esta medición aislada no demuestra por sí sola una mejora respecto de una versión anterior.

## Comprobación local del 18/11/2026

Con Node.js 24.15, Next.js 16.4.6 en desarrollo con webpack y PostgreSQL local en Docker, se consultó `GET /api/public/articles?pageSize=8` con una base de 25 artículos. Después del calentamiento, cinco solicitudes secuenciales, incluyendo lectura del JSON, tardaron **94.96, 111.40, 42.07, 42.66 y 41.78 ms**: media **66.57 ms** y mediana **42.66 ms**.

Esta comprobación verifica la respuesta del catálogo poblado. No se ejecutó nuevamente Lighthouse; las condiciones y el método difieren de la medición histórica de DevTools, por lo que estos resultados no permiten calcular una mejora porcentual.

## Ajustes del 19 de noviembre

Se reutilizan los listados iniciales renderizados en el servidor, evitando repetir las consultas al hidratar catálogo, subastas y artículos propios. La cabecera recibe la sesión inicial del servidor y comparte su consulta con la página durante la misma petición mediante React cache; no se guarda una caché global de sesiones. Al navegar se vuelve a comprobar la sesión.

La ficha de subasta usa una sola conexión Socket.IO para pujas, actualización de la ficha y avisos. El chat comparte su conexión con el contador de avisos. El panel consulta un único endpoint que ya incluye estado e historial, y el envío de pujas evita repetir la comprobación de sesión que ya realiza requireRole. Se conservan los controles de cuenta activa, comprador, propiedad del artículo y vigencia de la subasta.

En desarrollo se conservan hasta 30 entradas compiladas durante 30 minutos para reducir recompilaciones al alternar entre pantallas y perfiles. Esto consume más memoria que el buffer mínimo de desarrollo y no elimina la compilación inicial. También se reutiliza el formateador de fechas y se presenta un estado de carga durante las transiciones.

Comprobación HTTP local de pantallas calentadas, en desarrollo y con sesión: catálogo 326 ms, artículos propios 434 ms, aprobación de clientes 313 ms, panel 240 ms y ficha de subasta 612 ms. Son muestras individuales, no tiempos de interacción del navegador ni una comparación controlada antes y después. Las pruebas funcionales verificaron además que la API rechaza ofertas de administrador, auditor, verificador y vendedor sin perfil comprador, y que el listado de clientes excluye los perfiles internos.
