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
2. **Índice compuesto en PostgreSQL:** índice sobre `Article(title, category, status)` para apoyar búsquedas y filtros del catálogo.

## Observaciones

La puntuación de Performance obtenida fue **93/100**. Los valores anteriores son los observados en las capturas de Lighthouse del **16/11/2026**; no constituyen una comparación antes/después de las optimizaciones. El tiempo total del endpoint registrado en Network fue **1.16 s**. Esta medición aislada no demuestra por sí sola una mejora respecto de una versión anterior.
