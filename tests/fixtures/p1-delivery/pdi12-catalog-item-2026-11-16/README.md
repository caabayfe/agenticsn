# Native catalog-item capture evidence

Recorded on pdi12 (Brazil, SDK 4.14.0) during installation plan `739260906ad66251`.
The native catalog capture is in its original update set and all live authored values agree.
SDK-generated defaults include an empty `view` field even though the native `sc_cat_item`
dictionary has no such column; publication omits it. Source does not explicitly author this field.

Recognize only this recorded empty default. A nonempty authored or captured view, missing
ordinary fields and changed names, descriptions, active flags or flow bindings remain refused.
The fixture contains catalog metadata only; no business records or credentials.
