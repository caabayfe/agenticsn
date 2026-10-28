# Q07 to Q09 baselines: the employee chat (28 October 2026, 21:58-22:03)

All three run in the Employee Center Otto chat (`/esc?id=ai_native_chat`), asked in Spanish, as the
test user. Note: in this chat, Enter doesn't send; the send button does.

## Q07 Knowledge answer: VPN

**Answer key:** the only published VPN article is KB0000008 "How to configure VPN for Apple Devices"
(US university demo content). The two Spanish VPN articles (KB0010001, KB0010002) are drafts with
placeholder text ("Se ha resuleto por xxxx"). The incident history has a clear answer: 8 recent
incidents "No puedo conectar a la VPN" were resolved by updating the VPN client. A top answer, in
Spanish: there is no guide for Windows; the usual fix is updating the VPN client; here is how to get
help (an incident, prefilled).

**Question:** "No puedo conectarme a la VPN desde casa con mi portátil Windows, ¿qué hago?"

**Answer (21:58:56, about 50 s):**
> VPN troubleshooting. A documented cause of network connection problems is a device being configured
> only for IPv4 while the network is using IPv6. The guidance provided is to check with the device
> manufacturer for later firmware that adds IPv6 support ... For direct help with remote access to
> internal corporate systems, the corporate VPN request is the relevant support option.

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 0: irrelevant cause | 1: cites an article, the wrong one | 0 | 1: a link, to an access request rather than help | 0: English | 1 | **3 of 12** |

## Q08 Request software: Visio

**Answer key:** "Visio Pro for Office 365" is the right item (no questions to fill). "Install Software"
would need "What software do you need installed" = Visio. A top answer: one recommendation, the reason
("para diseñar diagramas de red") kept on the request, in Spanish, one confirmation.

**Question:** "Necesito que me instaléis Microsoft Visio en mi portátil para diseñar diagramas de red"

**What happened:** "Microsoft Visio installation help": two options (Visio Pro for Office 365, Install
Software) with no recommendation, in English. Visio link, then Start Request, then Submit created
**RITM0010058** (Visio Pro for Office 365, approved, in fulfilment, due 30 October). The reason was not
saved anywhere. The test user now has two identical Visio requests (RITM0010057 from the morning).

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2: right item available | 2 | 0: didn't notice an identical open request | 2: request created | 0: English; reason lost | 1: three clicks | **7 of 12** |

## Q09 Status of my requests

**Answer key:** RITM0010058 and RITM0010057, both Visio, approved, in fulfilment, due 30 October
(a duplicate); INC0025307 and INC0025306 New, in Network, not picked up; INC0025194 and INC0025193
resolved.

**Question:** "¿Cómo van mis solicitudes e incidencias?"

**Answer (22:02:56):** "Current ServiceNow Requests and Incidents": a list with links and states. The
requests are titled with the catalog's marketing text ("Create beautiful, compelling flowcharts,
graphs, and network diagrams in one easy...") instead of "Visio".

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2: states right | 2: links | 0: no stage, due date, approval or duplicate | 0: no next step | 0: English; marketing titles | 2 | **6 of 12** |
