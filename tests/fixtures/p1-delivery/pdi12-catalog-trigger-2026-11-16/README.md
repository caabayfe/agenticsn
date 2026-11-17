# Native Service Catalog publication evidence

Recorded on pdi12 (Brazil, SDK 4.14.0) from the reviewed request-fulfilment flow
`dc3159a909ded6793ee4603e8b142b6f` during installation plan `739260906ad66251`.
The build and native capture contain metadata only. No business records or credentials.

`native-contract.json` contains separately read native trigger outputs and action/logic inputs,
selected by the reviewed definition IDs. The native compiler projects the visible request-item
output, creates its catalog runtime trigger, and adds optional empty action inputs. It serializes
boolean true as `1`, an integer's caption as `1,000`, and the sort choice caption as `a to z`.
The For Each records parameter is added from its native logic-input definition.

Tests preserve execution values, scripts, authored identity and snapshot ownership. Missing
contracts, mutated trigger fields, wrong input types/owners, changed values, unknown descriptor
keys and duplicate/deleted generated records fail comparison. Recovery must still verify the
original capture and unchanged live version; this fixture does not authorize metadata replay.
