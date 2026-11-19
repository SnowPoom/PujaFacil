# Guía de exposición de PujaFácil

Aplicaciones Web Avanzadas · Primer bimestre · Exposición del 19 de noviembre de 2026

PujaFácil está preparada para demostrar el alcance implementado del primer bimestre: aplicación monolítica con cuentas, CRUD de artículos, revisión, subastas, pujas y chat en tiempo real. Esta guía permite ejecutar una demostración ordenada y comprobar qué debe verse en cada paso. La revisión del 18 de noviembre aprobó ESLint, compilación y 364 pruebas automatizadas, además de un recorrido con PostgreSQL, HTTP y dos clientes WebSocket reales.

La exposición dura 15 minutos y después hay 5 minutos de preguntas. El recorrido breve de la sección 3 prioriza la rúbrica; las secciones siguientes desarrollan cada operación para el ensayo y la defensa. No intenten ejecutar todas las variantes en 15 minutos. Pagos, entrega, firma digital pericial y evolución a microservicios no se presentan como funciones implementadas.

## 1 Preparación antes de entrar al aula

1. Abran Docker Desktop y esperen a que el motor esté activo. En VS Code abran la carpeta PujaFacil, que contiene package.json. No necesitan Visual Studio.
2. En una terminal ejecuten `docker compose up -d db`. Comprueben con `docker compose ps` que db esté saludable. En otra terminal ejecuten `npm.cmd run dev` y manténganla abierta.
3. Cuando aparezca Escuchando, abran `http://127.0.0.1:3000`. Utilicen esa misma dirección en todas las ventanas. En este equipo la base y las dependencias ya están preparadas; no ejecuten migraciones ni vuelvan a sembrar por rutina.
4. Preparen tres sesiones independientes: A en Chrome normal para vendedor, administrador y verificador; B en Chrome de incógnito para comprador1; C en Edge normal para comprador2. Dos pestañas de la misma sesión comparten la cuenta. Dos ventanas de incógnito del mismo navegador también pueden compartirla.
5. En A abran antes del ensayo catálogo, inicio de sesión, registro, recuperación, Mis artículos, Administración y Verificación, entrando con el rol correspondiente. Esto permite compilar las pantallas de desarrollo antes de proyectarlas. Dejen después A sin sesión para comenzar.
6. Comprueben que B y C abren Chat y muestran Conectado. Cierren pestañas duplicadas de chat para que la presencia sea fácil de interpretar. El contador representa conexiones a esa sala; no es un listado de identidades.
7. Tengan localizada una fotografía: `prisma/assets/reloj.jpg`. Para el registro usen `docs/recursos-exposicion/identidad-muestra.png`, una ficha sintética sin validez oficial. No usen documentos personales reales.
8. Lean DEMO_PASSWORD en el archivo local .env y guárdenla en una nota privada para el ensayo. No proyecten .env, claves, cookies ni enlaces de recuperación completos.
9. Preparen un reloj visible para el equipo, asignen quién maneja cada sesión y ensayen las transiciones. Todos deben explicar una parte y comprender el flujo completo.

Las subastas activas de la carga inicial cierran el 20 de noviembre por la noche. Repetir el seed conserva fechas y estados: no vuelve a abrirlas. Para demostrar el cierre durante la exposición se programa una subasta nueva mediante la interfaz, como indica la sección 7.

## 2 Cuentas y datos que deben tener a mano

La contraseña inicial común se obtiene de DEMO_PASSWORD en .env. Si cambian la contraseña de una cuenta, su nueva clave sustituye ese valor para esa cuenta. Esta guía se puede subir al repositorio porque no contiene contraseñas ni tokens.

| Sesión o uso | Correo | Perfil y preparación |
|---|---|---|
| A gestión | vendedor@pujafacil.test | Vendedor activo y dueño de los artículos del recorrido |
| A gestión | admin@pujafacil.test | Administración comercial y activación de cuentas |
| A gestión | verificador@pujafacil.test | Verificación de expedientes asignados |
| B | comprador1@pujafacil.test | Primer comprador activo |
| C | comprador2@pujafacil.test | Segundo comprador activo |
| A ampliación | verificador2@pujafacil.test | Otro verificador con asignación separada |
| A ampliación | auditor@pujafacil.test | Consulta de auditoría sin identidad de participantes |
| A ampliación | comerciante@pujafacil.test | Comprador y vendedor en una cuenta |
| A respaldo | pendiente@pujafacil.test | Cuenta pendiente con documento sintético |

Datos para el artículo del recorrido:

- Título: Cronógrafo de colección con estuche de Quito.
- Categoría: Relojería. Conservación: Excelente. Precio inicial: 1850.00 USD.
- Descripción: Cronógrafo de esfera clara con caja plateada y correa de cuero marrón, conservado en una colección particular de Quito. Incluye estuche de conservación.
- Procedencia: Colección particular de Quito, Pichincha. Se aporta registro de adquisición y referencia del estuche para la revisión de la casa de subastas.
- Fotografía: prisma/assets/reloj.jpg. Incremento de la subasta: 25.00 USD.

Anoten al crear el artículo su identificador y la URL. Al programar, anoten también la URL de su subasta. Los identificadores se generan; no deben copiar los de otra ejecución. Si repiten el ensayo, añadan al título la hora para reconocer la pieza nueva.

Respaldo disponible: Violín de concierto europeo requiere correcciones; Guitarra clásica de concierto está pendiente y asignada; hay piezas aprobadas, subastas activas, adjudicadas, suspendidas y una cerrada sin ofertas. Los estados pueden cambiar después de un ensayo: compruébenlos antes de exponer.

## 3 Recorrido breve de quince minutos

| Minutos | Acción y responsable sugerido | Evidencia que debe quedar visible |
|---|---|---|
| 0 a 1 | Integrante 1 presenta la casa de subastas y abre el catálogo | Problema local, piezas de alto valor, búsqueda, categoría y detalle |
| 1 a 3 | Integrante 1 muestra registro, cuenta pendiente e inicio de sesión; solicita recuperación de una cuenta de ensayo | Validaciones, acceso a Mi panel, enlace de recuperación en consola sin proyectar su token |
| 3 a 5 | Integrante 2 crea el artículo, consulta su ID, edita, sube foto y lo envía; muestra cancelación y confirmación de eliminación en otro borrador | CRUD completo, archivos, paginación y búsqueda |
| 5 a 7 | Integrante 3 asigna desde Administración y aprueba como verificador | Separación de roles, expediente y decisión registrada |
| 7 a 8 | Integrante 3 programa y activa la pieza con cierre cuatro minutos después | Fechas de Ecuador, validación y estado Activa |
| 8 a 10 | Integrante 4 usa B y C para dos pujas y muestra una notificación | Confirmación comercial, máximo e historial actualizados sin recargar |
| 10 a 11 | Integrante 4 abre la sala general en B y C, intercambia mensajes y recarga una ventana | Dos conexiones, recepción inmediata e historial persistente |
| 11 a 12 | Equipo vuelve a la ficha de la subasta y observa el cierre | Ganador por seudónimo y bloqueo de nuevas ofertas |
| 12 a 13 | Integrante 1 completa el restablecimiento solicitado y vuelve a ingresar | Token de un solo uso y contraseña nueva; usar solo cuenta de ensayo |
| 13 a 15 | Equipo explica monolito, datos, pruebas, rendimiento y uso de IA | Diagrama, esquema, resultados y límites del primer bimestre |

Los responsables son una propuesta; distribuyan estos bloques entre todos los integrantes reales. La guía de la materia exige participación de todos. Si tienen menos tiempo para operar, muestren la cuenta pendiente ya preparada y el expediente de respaldo. No omitan chat con dos usuarios, CRUD ni recuperación: son obligaciones explícitas de la rúbrica.

Frase de apertura sugerida: “PujaFácil permite a una casa de subastas ecuatoriana gestionar piezas exclusivas, revisar su expediente y recibir ofertas de participantes con identidad reservada. En este bimestre implementamos el monolito y el flujo hasta adjudicación”.

## 4 Visitante registro y recuperación

1. Sin sesión, abran Catálogo. Busquen collar y comprueben que aparece el artículo correspondiente. Limpien, filtren por Relojería y abran Ver detalle. Deben verse foto, categoría, conservación, procedencia y precio; no el correo o documento del vendedor. Cierren con Cerrar o Escape. Limpien y pasen a la página siguiente para evidenciar paginación.
2. Abran Registrarse. Intenten enviar sin datos para mostrar una validación requerida. Después completen nombre Elena Muestra Exposición, correo exposicion19@pujafacil.test y cédula sintética 0000000119. Elijan una contraseña privada de 15 a 64 caracteres que cumpla las reglas; pueden usar el valor local de DEMO_PASSWORD. Seleccionen Comprador y Vendedor, adjunten identidad-muestra.png y marquen la confirmación del formulario. Pulsen Crear cuenta.
3. Debe aparecer Cuenta creada, pendiente de aprobación. Si el correo se usó en el ensayo, elijan otro correo de demostración; no borren una cuenta para repetir el registro. Mantengan el mismo nombre y cédula de la ficha sintética.
4. Inicien sesión con esa cuenta. En Mi panel debe aparecer Pendiente; la cuenta no puede publicar, pujar ni escribir en el chat. Cierren sesión. Conserven el correo y la clave en su nota privada.
5. Abran Recuperar contraseña y soliciten el enlace para esa cuenta de ensayo. En la terminal del servidor localicen la línea [auth] Recuperación. Copien la URL de forma privada a una pestaña de la misma sesión. El enlace vence en diez minutos; en el recorrido breve pueden completar este paso al minuto 12 si aún está vigente, o solicitar uno nuevo entonces.
6. Ingresen y confirmen una contraseña nueva conforme al formulario. Guárdenla en la nota privada. Debe mostrarse el resultado satisfactorio; inicien sesión con ella y comprueben que vuelve a Mi panel. Reabrir el mismo enlace debe impedir otro cambio. No cambien las claves de los compradores que están participando en la demostración.
7. Intenten acceder a /mis-articulos sin sesión después de cerrar sesión: debe requerirse autenticación. Expliquen que el catálogo es público y Mi panel es la pantalla principal privada exigida por la rúbrica.

La simulación de correo por consola está admitida expresamente por las indicaciones. No digan que se envió un correo real. La caducidad puede explicarse y respaldarse con pruebas; no esperen diez minutos en directo para demostrarla.

## 5 CRUD de artículos como vendedor

1. En A inicien sesión con vendedor@pujafacil.test. Abran Mi panel y después Mis artículos. Muestren títulos, identificadores y estados. Usen Siguiente y Anterior con la lista sin filtrar; hay suficientes artículos para demostrar paginación.
2. Busquen violín y pulsen Buscar. Abran Ver / Editar. Muestren las observaciones del verificador en el artículo que requiere correcciones. No es necesario modificar esta pieza en el recorrido breve. Regresen y limpien la búsqueda.
3. Abran la creación de un nuevo artículo y completen los datos de la sección 2. Antes de guardar, prueben un precio inválido o una descripción demasiado corta, observen el error y corrijan. Pulsen Guardar borrador.
4. Copien el código de referencia y la URL del expediente. Esa dirección demuestra consulta individual por identificador. En Mis artículos busquen una parte distintiva del título y abran Ver / Editar. Cambien el título añadiendo con estuche y pulsen Guardar cambios de texto. Recarguen para comprobar persistencia.
5. En Fotografías del artículo seleccionen prisma/assets/reloj.jpg. Esperen a ver la miniatura y el contador de fotografías. Se admite JPEG, PNG y WebP hasta 10 MB; el certificado PDF es opcional y admite hasta 20 MB. No usen una imagen renombrada como PDF.
6. Antes de enviar el artículo comercial, creen otro borrador con los mismos datos y el título Borrador de ensayo para retirar. No lo envíen a revisión. En la lista pulsen Eliminar y después Cancelar: debe seguir allí. Repitan Eliminar y confirmen: debe desaparecer. Solo este borrador desechable se elimina.
7. Vuelvan al artículo comercial, comprueben su fotografía y pulsen Enviar a revisión. Debe quedar Pendiente de revisión. Al abrir de nuevo su ficha, la edición ordinaria debe estar bloqueada por el estado del expediente.

Resultado que se explica: se demostraron crear, consultar por búsqueda y por ID, actualizar y eliminar con confirmación; los datos persisten en PostgreSQL y el archivo queda asociado al expediente. La eliminación no se ofrece como forma de retirar un artículo que ya tiene revisión o subasta.

Si no encuentran el artículo recién creado, limpien el filtro o pulsen Buscar otra vez. Si no permite enviar, abran la ficha y comprueben que terminó la carga de al menos una fotografía. No cambien el estado con una herramienta de base de datos.

## 6 Administración y verificación del expediente

1. En A cierren sesión como vendedor e ingresen con admin@pujafacil.test. Abran Administración y muestren el resumen de cantidades y los accesos a cuentas, verificaciones y subastas.
2. Para la ampliación, entren a Usuarios, filtren Pendientes y pulsen Revisar cuenta en la cuenta nueva de la sección 4 o en pendiente@pujafacil.test. La tabla muestra referencias internas; identifiquen la cuenta por los datos dentro de la revisión protegida, cerrando la revisión si eligieron otra fila.
3. Cotejen el nombre y la cédula con la ficha sintética. Marquen He revisado el documento y comprobado su coherencia, seleccionen el motivo disponible y pulsen Confirmar activación. En el diálogo pulsen Activar. Debe quedar activa. No activen pendiente@pujafacil.test durante el ensayo si quieren conservarla como respaldo para mañana.
4. Entren a Verificaciones. Localicen el artículo comercial por su título y código. Seleccionen el verificador activo correspondiente a verificador@pujafacil.test y pulsen Asignar. Debe indicar que está asignado y no permitir otra asignación abierta sobre ese expediente.
5. Cierren sesión e ingresen como verificador@pujafacil.test. Entren a Verificación, abran el expediente asignado y revisen descripción, procedencia y fotografía. Si hubiera certificado, consulten el adjunto. No corresponde al verificador activar la subasta.
6. Recorrido breve: elijan Aprobar, escriban “Fotografías y procedencia revisadas. Expediente apto para programación comercial.” y pulsen Emitir resolución. Debe registrarse el dictamen y el artículo pasar a Aprobado.
7. Recorrido ampliado: antes de aprobar, elijan Solicitar correcciones y escriban “Confirma la procedencia y la referencia del estuche de conservación”. Emitan resolución. Regresen como vendedor, abran el artículo y muestren el comentario; actualicen la procedencia, guarden y reenvíen. Como administrador vuelvan a asignarlo; como verificador apruébenlo. Este ciclo requiere una nueva asignación y no conserva una aprobación anterior.
8. Como vendedor, comprueben el resultado y su observación. Como administrador, comprueben que ya aparece en el selector de artículos aprobados para programar una subasta.

El rechazo se demuestra en un expediente de ensayo separado, si hay tiempo, porque lo deja fuera de programación. La aprobación representa la revisión documental de la casa de subastas; no una certificación pericial automatizada ni una firma digital implementada.

## 7 Programación y apertura de la subasta

1. En A ingresen como administrador y abran Administración → Subastas. En Programar nueva subasta elijan el artículo comercial aprobado, comprobando título y precio.
2. Indiquen precio de salida 1850.00 e incremento mínimo 25.00. Para demostrar validación, introduzcan primero un cierre anterior a la apertura, pulsen Programar y muestren el rechazo. Después corrijan ambas fechas.
3. Usen la fecha real del día de la exposición. Las horas del formulario son de Ecuador continental. Pongan la apertura un minuto antes de la hora actual y el cierre cuatro minutos después para el recorrido breve; para ensayar sin prisa, ocho minutos después. No copien una fecha fija del 18 de noviembre.
4. Pulsen Programar. La nueva subasta debe aparecer Programada y el artículo debe quedar asociado a ella. Copien el código y abran Ver ficha pública. Conserven su URL para B y C.
5. Regresen a la supervisión. El servidor comprueba el ciclo de vida cada diez segundos y activa automáticamente las programadas cuya apertura ya llegó. Si la fila aún está Programada, pueden pulsar Activar para hacerlo desde Administración. Si ya aparece Activa, no repitan la operación. El temporizador del navegador no decide el estado.
6. Abran la misma URL en B y C. Confirmen título, precio de salida, incremento, máximo, número de ofertas, estado y cierre. Debe mostrarse el mínimo aplicable para pujar. Anoten el minuto de cierre para regresar a tiempo después del chat.
7. Como vendedor, en una transición posterior, entren a Mis subastas y localicen la pieza; debe aparecer vinculada a su artículo y con su estado. El comprador consulta su actividad en Mis ofertas.

Para mostrar una subasta próxima sin esperar, abran una que siga Programada. No debe aceptar pujas antes de su apertura y activación. Si la programada del seed ya quedó vencida, usen una nueva pieza aprobada y fechas futuras mediante la interfaz.

La suspensión se reserva para la sección 10 y para otra subasta. No suspendan la pieza que debe adjudicarse en esta demostración. Si se agota su plazo antes de que alguien puje, terminará sin ofertas: es un resultado válido; programen otra pieza aprobada para repetir el ejercicio, sin alterar el reloj ni los datos por SQL.

## 8 Pujas y notificaciones en dos sesiones

1. En B comprueben que la sesión es comprador1@pujafacil.test y en C comprador2@pujafacil.test. Ambos deben tener la misma ficha de subasta activa. Mantengan visibles las dos ventanas, idealmente lado a lado.
2. En B introduzcan el mínimo mostrado, que en una subasta nueva con estos datos es 1850.00. Pulsen el botón de oferta. En el diálogo lean artículo, importe y compromiso comercial. Primero cancelen para mostrar que aún no se registra una puja; repitan y confirmen.
3. Debe aparecer aceptación en B. Sin recargar C, observen el nuevo máximo y número de ofertas. El historial debe mostrar fecha, importe y seudónimo, sin nombre o correo del comprador. Si tarda la conexión inicial, esperen a que esté conectada antes de enviar otra oferta.
4. En C oferten el nuevo mínimo, normalmente 1875.00 si solo existe la primera puja. Confirmen. B debe recibir el cambio de máximo sin F5. Usen siempre el mínimo actual de la pantalla, no un importe memorizado de otro ensayo.
5. Para el rechazo comercial, intenten una oferta inferior al mínimo mostrado. Si la pantalla la bloquea, expliquen esa validación. Para demostrar rechazo desde el servidor y concurrencia, utilicen la evidencia de pruebas indicada en la sección 11; no modifiquen el código ni desactiven validaciones durante la exposición.
6. Demuestren la notificación adicional al chat: primero hagan en B otra puja válida para que comprador1 vuelva a tener la oferta máxima. Después, en B abran una segunda pestaña de esa misma sesión en Notificaciones y esperen Avisos en vivo activos. En C superen esa oferta con el nuevo mínimo válido. En la bandeja B debe llegar el aviso de Oferta superada sin recargar: se notifica al líder anterior cuando otro comprador lo supera.
7. Pulsen Marcar como leída en el aviso, comprueben Leída y el contador de pendientes. Abran Ver detalle para volver a la subasta. En B entren también a Mis ofertas y muestren artículo, importe, fecha y estado.

El evento de puja en vivo ya demuestra una funcionalidad WebSocket adicional al chat, incluso si no se dedica tiempo a abrir la bandeja. La prueba de concurrencia ejecutada envió dos ofertas del mismo importe: una obtuvo 201 y la otra 409. También verificó que repetir una solicitud con el mismo identificador no crea una segunda oferta.

No intenten pujar como vendedor sobre su propia pieza. El rechazo de autooferta puede explicarse como regla de negocio y mostrarse opcionalmente con la cuenta de ambos perfiles sobre un artículo propio, si se prepara ese caso aparte.

## 9 Chat con historial y presencia

1. En B y C abran Chat desde el menú. Ambos deben estar en Sala general, con estado Conectado. Observen Usuarios conectados. Si cuentan más de dos, cierren las otras pestañas de chat o expliquen que hay conexiones adicionales.
2. En B escriban “Buenas tardes, deseo consultar las condiciones de participación” y pulsen Enviar mensaje. C debe recibirlo sin recargar. En C respondan “La ficha permite revisar la pieza y el incremento antes de ofertar”. B debe recibirlo inmediatamente.
3. Comprueben que aparecen seudónimos y hora, no datos personales. Intenten enviar vacío: debe impedirse. Opcionalmente escriban un correo de prueba como contacto@ejemplo.test; el mensaje se sanea y ese patrón se sustituye por dato oculto.
4. Recarguen solo B. El mensaje reciente debe seguir en el historial después de reconectarse. Se recuperan hasta los 30 últimos mensajes de la sala; no prometan historial infinito o paginación del chat.
5. Para presencia, naveguen C a Mi panel y observen cómo cambia el contador de la sala que B mantiene abierta. Vuelvan C a Chat y comprueben la actualización. La salida y reconexión pueden tardar unos instantes.
6. Si hay tiempo, desde la ficha de la subasta sigan el acceso a su sala. Abran la misma sala en ambas sesiones. Expliquen que la sala general y la de subasta son distintas y que el servidor comprueba el acceso. Vuelvan a la ficha a tiempo para su cierre.

Explicación técnica breve: Socket.IO corre en el mismo servidor Node que Next.js. Valida la sesión al conectar y organiza las conexiones por salas. chat:join entra a una sala, chat:send solicita guardar un mensaje, chat:new lo distribuye y chat:presence comunica las conexiones. Socket.IO puede iniciar con polling y negociar WebSocket; no se debe afirmar que cualquier petición repetida es una conexión WebSocket.

Para mostrar transporte real, en DevTools abran Network → WS y seleccionen la conexión socket.io. En HTTP local el transporte es ws; el despliegue con TLS usa wss. Las pruebas de la revisión comprobaron WebSocket real en HTTP local; las evidencias previas de WSS están en docs/evidencias. No presenten una prueba HTTP como comprobación nueva de WSS.

## 10 Cierre del negocio y funciones adicionales

1. Vuelvan a la subasta nueva antes del cierre. Mantengan ambas fichas abiertas sin recargarlas y esperen el minuto configurado. El proceso periódico del servidor debe cerrarla y actualizar el resultado; concedan hasta diez segundos al ciclo del servidor.
2. Con pujas válidas debe aparecer Adjudicada y un único ganador por seudónimo. El historial conserva las ofertas aceptadas. La cuenta regresiva es informativa: quien decide aceptar o rechazar es el servidor.
3. Comprueben que no puede enviarse una nueva oferta. Revisen el aviso del ganador o el cierre en Notificaciones y la consulta en Mis ofertas y Mis subastas. La adjudicación no representa pago ni entrega realizados.
4. Muestren una subasta histórica Cerrada sin ofertas para contrastar los dos resultados. El catálogo y las fichas conservan resultados; no borran automáticamente las piezas al terminar.
5. En la ampliación, como administrador programen otra pieza aprobada o usen una subasta de ensayo que no necesiten cerrar. Introduzcan “Revisión adicional del expediente comercial” como motivo y pulsen Suspender. Debe quedar Suspendida y rechazar nuevas pujas. No se demuestra reanudación, cancelación o pago como si existieran controles actuales para ello.
6. Como vendedor, abran Mi perfil. Modifiquen un teléfono y dirección de demostración, por ejemplo 0990000119 y Quito, sector de prueba académica. Guarden y recarguen. Solo cambian datos de contacto propios; no roles o estado. No usen contacto real.
7. Ingresen como auditor@pujafacil.test. Abran Auditoría, revisen fecha, operación, recurso y resultado, filtren una acción existente y recorran otra página si hay suficientes registros. El auditor no necesita conocer la identidad real del comprador o vendedor.
8. Opcionalmente entren como verificador2 para mostrar que su bandeja contiene sus propias asignaciones; como comerciante, muestren que aparecen Mis artículos y Mis ofertas. Cierren sesión al terminar.

Las operaciones del ensayo consumen estados: una cuenta activada deja de estar pendiente y un expediente aprobado ya no está en su cola. Conserven casos de respaldo y creen nuevos borradores mediante la aplicación cuando repitan. No reinicien estados por SQL ni eliminen la base antes de exponer.

## 11 Defensa técnica y evidencia disponible

Arquitectura: abran docs/arquitectura-monolito.png. Next.js renderiza las rutas del servidor y utiliza componentes cliente para interacciones. server.ts inicia el servidor Node propio e incorpora Socket.IO. Presentación, negocio y persistencia forman un proyecto desplegable; disponer de rutas /api internas no lo convierte en microservicios.

Datos: abran docs/modelo-datos.png y docs/modelo-datos.md. La entidad Article tiene título, descripción, categoría, conservación, procedencia, precio y estado, superando los cinco atributos mínimos. Expliquen su relación con User, FileRecord, Review, Auction y Bid, además de ChatMessage y Notification. Los archivos se guardan fuera de public y la base conserva sus referencias.

Validación y acceso básicos exigidos por Apps Web: muestren que una ruta privada pide sesión, el registro valida campos y el servidor usa esquemas Zod. Las contraseñas se verifican con bcrypt y sal; no se almacenan en texto claro. Pueden abrir el código de autenticación, sin proyectar .env o datos de sesión. El servidor WebSocket autentica al conectar y valida cada operación. Esto cubre la explicación básica de la materia, sin extender la defensa a los requisitos futuros de Seguridad de Software.

Pruebas: expliquen el resultado del 18 de noviembre, 364 pruebas aprobadas y compilación y lint correctos. El recorrido src/tests/app-flow.integration.ts también comprobó con la base real CRUD, foto, correcciones, reenvío, aprobación, dos clientes WebSocket, chat, idempotencia, concurrencia y cierre con ganador. No lo ejecuten en pleno recorrido: crea otra pieza y otra subasta. Para el ensayo automatizado se usa `npx.cmd tsx src/tests/app-flow.integration.ts` con el servidor y la base activos.

Rendimiento: abran docs/rendimiento.md. La medición local del 18 de noviembre hizo cinco consultas al catálogo de ocho elementos por página con 25 artículos en la base: mediana 42.66 ms y media 66.57 ms, incluyendo lectura del JSON. La medición histórica de Lighthouse fue 93/100 el 16 de noviembre; no se volvió a ejecutar Lighthouse. No comparen porcentualmente mediciones obtenidas con métodos diferentes. Expliquen la paginación y los índices existentes; no afirmen que toda búsqueda parcial utiliza un índice sin EXPLAIN.

Preparación de comandos: `npm.cmd test`, `npm.cmd run lint` y `npm.cmd run build` reproducen las comprobaciones. El build se ejecuta antes de la sesión, con el servidor de desarrollo detenido para no compartir .next. Conserven luego el servidor de desarrollo activo para la demostración.

Uso de IA: declaren Codex como apoyo para correcciones, datos sintéticos, pruebas y documentación, conforme al README. Cada integrante debe poder explicar y modificar su parte. Repositorio: https://github.com/SnowPoom/PujaFacil, rama christian. La versión y etiqueta de entrega se conservan como estaban; esta guía no las modifica.

## 12 Cobertura y respuesta ante imprevistos

| Requisito del primer bimestre | Demostración de esta guía |
|---|---|
| RF APP 01 a 07 registro y autenticación | Sección 4 y cierre de sesión entre roles |
| RF APP 08 a 11 perfil y activación | Secciones 6 y 10 en recorrido ampliado |
| RF APP 12 a 14 principal y navegación | Mi panel, menús por rol y catálogo público |
| RF APP 15 a 20 y 22 a 25 CRUD archivos y catálogo | Secciones 4 y 5 con borrador comercial y desechable |
| RF APP 21 certificado opcional | Explicación del adjunto en secciones 5 y 6; carga solo si preparan un PDF de muestra |
| RF APP 26 a 30 verificación | Sección 6; aprobación breve y ciclo de correcciones ampliado |
| RF APP 31 a 39 gestión de subastas | Secciones 7 y 10; suspensión y resumen en ampliación |
| RF APP 40 a 47 ofertas y tiempo real | Sección 8; concurrencia e idempotencia respaldadas por pruebas |
| RF APP 48 y 49 cierre y ganador | Sección 10 y comparación con cierre sin ofertas |
| RF APP 50 a 53 chat | Sección 9 con dos usuarios, historial y presencia |
| RF APP 54 a 58 avisos y auditoría | Secciones 8 y 10 |
| Monolito base de datos y calidad | Sección 11 con diagramas, validación, pruebas y medición |

Si no abre la aplicación: comprueben Docker Desktop, docker compose ps, la terminal activa del servidor y la dirección 127.0.0.1:3000. Si el puerto está ocupado, detengan la otra instancia desde su terminal. No ejecuten docker compose down -v ni sustituyan .env.

Si aparece una pantalla de carga: concedan tiempo a la primera compilación. Si hay fallo después de cambiar .env con el servidor activo, detengan esa instancia con Ctrl+C y vuelvan a ejecutar npm.cmd run dev; no editen variables durante la exposición.

Si las dos ventanas muestran la misma cuenta: las sesiones están compartidas. Usen otro navegador o un contexto de incógnito independiente y vuelvan a ingresar. Si el chat no recibe mensajes, comprueben cuenta activa, Conectado y misma sala antes de repetir el envío.

Si no hay un artículo disponible para una etapa: consulten su estado y usen un caso de respaldo o creen uno nuevo por la interfaz. Si no alcanza el tiempo para esperar un cierre, muestren una adjudicación persistida y expliquen la evidencia del cierre automatizado; no simulen una actualización manual como un evento en vivo.

Fuentes de alcance: Guía del Proyecto AppWebAv.docx y PujaFacil_Requisitos_Funcionales_1B_AppWebAv.docx, en la carpeta Fuentes del proyecto. Las reglas generales del negocio se contrastan con el alcance específico del primer bimestre. La guía cubre demostraciones funcionales; las diapositivas, la participación del equipo y los elementos administrativos de entrega deben revisarlos los integrantes antes de presentar.
