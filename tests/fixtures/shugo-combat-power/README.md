# Public contract fixtures

Captured from Shugo's `GET /api/leaderboard/combat-power` and NCSOFT's official
`character/info`, `character/equipment` and `character/equipment/item` endpoints
on 2026-10-09. Character names, encrypted IDs and image character keys are replaced
with sample values. Region, class, score, pagination and timestamp fields retain
the observed schema. Unit tests never contact these services.

`schema-changed.json` deliberately renames `entries` to demonstrate schema drift.
`forbidden.json` contains the observed rejection body when required request
headers were absent. HTML rejection tests use synthetic login/challenge bodies;
production does not parse HTML.
