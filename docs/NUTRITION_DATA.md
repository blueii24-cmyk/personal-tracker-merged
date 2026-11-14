# Offline nutrition reference

The packaged food snapshot is derived from Open Food Facts © Open Food Facts contributors,
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/), with individual
contents under the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).
The derived database is available as `src/tracker/lib/nutrition/india-packaged.json` under
ODbL 1.0; its contents are under DbCL. Original database: https://world.openfoodfacts.org/data.

Snapshot: [India extract 2026-05-27](https://github.com/mvark/indiafoodstats/blob/ea3f82aac33bf36fe3773e7e53d60a5d8d1d4364/data/all_2026-05-27_17139.csv).
The [extract workflow](https://github.com/mvark/indiafoodstats/blob/ea3f82aac33bf36fe3773e7e53d60a5d8d1d4364/.github/workflows/fetch_Datasette_OFF_IndiaProducts.yml) selects
Open Food Facts `energy-kcal_100g` and `proteins_100g`. We retain rows with a numeric
barcode, a name, a brand, and a plausible numeric kcal value; round nutrient values to one
place, limit text lengths, and omit other fields. Protein may be null. One additional row, [Kurkure Masala Munch](https://world.openfoodfacts.org/product/8901491361026), was checked against the Open Food Facts per-100g table (558 kcal, 6.4 g protein).

The snapshots are not
live and are incomplete, crowdsourced, and not independently label-verified. Per-100g fields
for liquids may refer to 100ml; consult the product label. Rows with barcodes link to the corresponding product. Values are not a substitute for checking the current packet.

Selected example dishes are derived from [USDA FoodData Central FNDDS 2021–2023](https://fdc.nal.usda.gov/download-datasets/), using Survey (FNDDS) rows in [USDA foods.csv](https://github.com/PRIYAN-A-1/FOOD-NUTRITION-DATASET-/blob/1c5333a5026cb096552f53cf143b60ea074b2553/food_nutrition_dataset/data/foods.csv). Names were mapped to search aliases. USDA data is public domain; recipe values describe an example and may not reflect local cooking.

The khichdi recipe value is from Vijayakumar et al.,
“Development of an Indian Food Composition Database”, Current Developments in Nutrition
(2024), https://doi.org/10.1016/j.cdnut.2024.103790. It describes a specific recipe,
not all preparations; protein is unknown. The complete INDB spreadsheet is not bundled:
its repository says files are freely available but does not specify a data license.

The reference is searched locally, without transmitting food searches to Open Food Facts.
Only possible matches and the user's message are sent to the user's chosen AI provider (or
the authenticated default relay). Match candidates are not verified identities or automatic
writes. The model should ask about ambiguity and portion size and label calculations as
estimates. Unknown nutrients are not zero. This snapshot does not cover all Indian foods or
products and will not update itself.

To rebuild the derived files, download the two pinned files linked above and run
`python3 scripts/build-nutrition-reference.py INDIA_OFF.csv USDA_foods.csv`.
The current snapshot contains 1,378 packaged rows and 19
USDA dish entries, plus the individual khichdi reference. No data is updated automatically.
