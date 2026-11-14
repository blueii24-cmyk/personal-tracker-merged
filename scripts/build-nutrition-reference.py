#!/usr/bin/env python3
"""Build the offline reference from the two pinned source files in docs/NUTRITION_DATA.md.

Usage: python3 scripts/build-nutrition-reference.py INDIA_OFF.csv USDA_foods.csv
The inputs are downloaded separately. No network access or credentials are needed.
"""
import csv
import json
import math
import re
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
root = Path(__file__).resolve().parent.parent / 'src/tracker/lib/nutrition'
rows = []
with open(sys.argv[1], encoding='utf-8', newline='') as file:
    for row in csv.DictReader(file):
        code, name, brand = (row[k].strip() for k in ('code', 'product_name', 'brands'))
        try:
            kcal = float(row['energy-kcal_100g'])
        except ValueError:
            continue
        if not re.fullmatch(r'\d{4,18}', code) or not name or not brand or not math.isfinite(kcal) or not 0 <= kcal <= 900:
            continue
        try:
            protein = float(row['proteins_100g'])
            protein = round(protein, 1) if math.isfinite(protein) and 0 <= protein <= 100 else None
        except ValueError:
            protein = None
        rows.append([code, name[:120], brand[:100], round(kcal, 1), protein])
# This additional product was checked directly against the linked OFF per-100g table.
rows.append(['8901491361026', 'Kurkure Masala Munch', 'Kurkure', 558.0, 6.4])
with (root / 'india-packaged.json').open('w', encoding='utf-8') as file:
    json.dump(rows, file, ensure_ascii=False, separators=(',', ':'))

aliases = {'Cheese, paneer':'paneer', 'Beef curry':'beef curry', 'Chicken curry':'chicken curry', 'Fish curry':'fish curry',
           'Biryani with meat':'meat biryani', 'Biryani with chicken':'chicken biryani', 'Biryani with vegetables':'vegetable biryani',
           'Dal':'dal', 'Lentil curry':'lentil curry', 'Bread, naan':'naan', 'Bread, paratha':'paratha', 'Idli':'idli',
           'Dosa, plain':'plain dosa', 'Samosa':'samosa', 'Dosa, with filling':'filled dosa', 'Chutney':'chutney',
           'Palak Paneer':'palak paneer', 'Pakora':'pakora', 'Vegetable curry':'vegetable curry'}
with open(sys.argv[2], encoding='utf-8', newline='') as file:
    dishes = [[aliases[row['name']], row['name'], float(row['energy_kcal_100g']), round(float(row['protein_g_100g']), 1)]
              for row in csv.DictReader(file) if row['source_type'] == 'Survey (FNDDS)' and row['name'] in aliases
              and row['energy_kcal_100g'] and row['protein_g_100g']]
with (root / 'dishes.json').open('w', encoding='utf-8') as file:
    json.dump(dishes, file, separators=(',', ':'))
print(f'{len(rows)} packaged rows, {len(dishes)} dishes')
