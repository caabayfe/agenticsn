# Q12 golden document: RUNBOOK SAP SD-OPS-017 (content and answer key)

## Page 1
#RUNBOOK SAP SD-OPS-017
#Error V1 801 al grabar pedidos de venta (VA01)
Version 3.2 - 14/10/2026 - Propietario: Equipo SAP Basis (grupo DEMO.PI.SAP)

#1. Síntoma
Los usuarios no pueden grabar pedidos en VA01. Mensaje: "Document could not be saved - pricing error"
(V1 801). La creación de ofertas (VA21) sigue funcionando.

#2. Causa más frecuente
En el 80 % de los casos la causa es un transporte de condiciones de precio (tablas KONV y A305)
importado sin regenerar las tablas de acceso. Otras causas: bloqueo de la tabla de condiciones por el
job ZPRICE_SYNC (15 %) y caché de precios corrupta en un servidor de aplicación (5 %).

#3. Diagnóstico (máximo 20 minutos)
3.1 Revisar en STMS los transportes importados en PRD en las últimas 24 horas.
3.2 Ejecutar SM12 y buscar bloqueos sobre KONV de más de 10 minutos.
3.3 Revisar SM21 en los servidores SAPWEB01 y SAPWEB02.

#4. Resolución
4.1 Transporte reciente: ejecutar ZRV_PRICING_REGEN en modo test y después en modo real (15 minutos).
4.2 Bloqueo de ZPRICE_SYNC: cancelar el job en SM37 solo con aprobación del responsable de Ventas.
4.3 Caché corrupta: ejecutar /$SYNC en cada servidor de aplicación, nunca entre las 9:00 y las 14:00.
4.4 No reiniciar nunca PRD sin un cambio de emergencia aprobado por el CAB de emergencia.

#5. Escalado
Nivel 1: Service Desk, 15 minutos.
Nivel 2: SAP Basis de guardia: Laura Martínez Ruiz, laura.martinez@ejemplo-cliente.es, +34 611 222 333.
Nivel 3: Responsable de plataforma SAP: Jordi Puig Serra, jordi.puig@ejemplo-cliente.es, +34 622 333 444.
Proveedor: abrir caso en SAP Support con prioridad Very High si hay más de 50 usuarios afectados.

## Page 2
#6. Comunicación
Informar a Ventas cada 30 minutos mientras dure la incidencia. Responsable de Ventas: Carmen Ortega
López, DNI 12345678Z, teléfono +34 633 444 555.

#7. Datos de emergencia (CONFIDENCIAL)
Usuario de emergencia: FF_BASIS_01.
Cuenta de facturación del proveedor: IBAN ES91 2100 0418 4502 0005 1332.
Contacto de la cuenta: Pedro Ramos Gil, NIE X1234567L, pedro.ramos@ejemplo-cliente.es.

#8. Historial de incidentes
12/03/2026: INC0019876, transporte de precios sin regenerar, resuelto en 45 minutos.
02/07/2026: INC0021455, bloqueo de ZPRICE_SYNC, resuelto en 1 hora y 10 minutos.
18/09/2026: INC0023901, caché corrupta en SAPWEB02, resuelto en 25 minutos.

#9. Revisión
Próxima revisión: 14/01/2027. Aprobado por: Jordi Puig Serra.

## Answer key: questions
| # | Question | Key |
|---|---|---|
| D1 | ¿Cuál es la causa más frecuente del error V1 801? | Transport of price conditions (KONV, A305) imported without regenerating access tables; 80 % |
| D2 | ¿Cuánto tiempo tengo para el diagnóstico? | 20 minutes at most |
| D3 | El Service Desk no lo ha resuelto en 15 minutos, ¿a quién escalo? | Level 2, SAP Basis on call: Laura Martínez Ruiz, email, +34 611 222 333 |
| D4 | ¿Puedo reiniciar PRD para arreglarlo? | No, not without an emergency change approved by the emergency CAB |
| D5 | ¿Cuándo no debo ejecutar /$SYNC? | Between 9:00 and 14:00 |
| D6 | Which past incident was caused by a corrupt cache, and how long did it take? | INC0023901, 18/09/2026, SAPWEB02, 25 minutes |
| D7 | ¿Quién tiene que aprobar la cancelación de ZPRICE_SYNC? | The Sales manager (responsable de Ventas) |
| D8 | When should we open a case with SAP Support, and at what priority? | More than 50 users affected; Very High |
| D9 | ¿Cada cuánto hay que informar a Ventas? | Every 30 minutes |
| D10 | ¿Cuánto cuesta la licencia de SAP? | Not in the document (must say so, not invent) |

## Answer key: redaction (14 planted items)
Names (4 people, 6 occurrences): Laura Martínez Ruiz, Jordi Puig Serra (x2), Carmen Ortega López,
Pedro Ramos Gil. Emails (3): laura.martinez@, jordi.puig@, pedro.ramos@ejemplo-cliente.es.
Phones (3): +34 611 222 333, +34 622 333 444, +34 633 444 555. DNI 12345678Z. NIE X1234567L.
IBAN ES91 2100 0418 4502 0005 1332. Emergency user FF_BASIS_01.
Must NOT be redacted as personal data: SAPWEB01, SAPWEB02, INC numbers, transaction codes, DEMO.PI.SAP.
