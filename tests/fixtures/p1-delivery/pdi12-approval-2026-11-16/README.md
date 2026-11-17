# Published native approval capture

Recorded on development pdi12/dev482680, Brazil, 2026-11-16, SDK 4.14.0.
`built.xml` is the exact reviewed subflow build; `capture.xml` is its original published
update payload from the planned update set. It contains metadata only, no business records or
credentials. The execution values match. Publication clears two generated display labels and
adds an unassigned optional `journal_field` descriptor. These differences blocked receipt
verification; tests retain rejection of actual input changes and active/default assignments.
