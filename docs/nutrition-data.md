# Local nutrition data

Scranbook calculates nutritional estimates in the browser. It does not call a
nutrition API and does not send ingredient names, quantities, diary entries, or
photos to a nutrition provider.

## Included sources

The generated `public/nutrition/foods.json` index contains 8,672 normalized food
records from:

- USDA FoodData Central Foundation Foods, release 2026-04-30. Public domain,
  published under CC0 1.0.
- USDA FoodData Central Food and Nutrient Database for Dietary Studies (FNDDS)
  2021-2023, release 2024-10-31. Public domain, published under CC0 1.0.
- McCance and Widdowson's UK Composition of Foods Integrated Dataset (CoFID),
  release 2021. Reused under the Open Government Licence v3.0.

Contains public sector information licensed under the Open Government Licence
v3.0.

Source pages:

- <https://fdc.nal.usda.gov/download-datasets/>
- <https://fdc.nal.usda.gov/api-guide/>
- <https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid>
- <https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/>

## Generated format

Each record contains a stable source ID, food name, category, provenance, and
values per 100 g for energy, protein, carbohydrate, fat, fibre, and sodium. The
client converts sodium to salt using the conventional factor of 2.5.

The vision model estimates ingredient weights in grams but does not calculate
nutrition. Scranbook normalizes each ingredient name, performs a local fuzzy
match, scales the database values by the estimated consumed weight, and stores
the chosen match and resulting totals with the diary entry. Unmatched or
lower-confidence ingredients are shown to the user for review.

Recipe-card and unclear images are not automatically treated as consumed meals.
The user must classify an entry as a meal and enter the quantities actually
eaten before calculating nutrition.

## Rebuilding

Run:

```sh
pnpm nutrition:data
```

The generator downloads the pinned official releases, reads their JSON/XLSX
files, retains the nutrients Scranbook uses, and replaces the committed local
index. Upstream downloads happen only during this explicit maintenance command,
not during application builds or at runtime.

When updating a source release:

1. Update the pinned URL and version in `scripts/build-nutrition-data.ts`.
2. Run `pnpm nutrition:data`.
3. Review the record count and a representative sample from each source.
4. Run unit, browser, offline, and live-model verification.
5. Update this document and the dataset version shown in release notes.

## Accuracy limits

Nutrition totals can only be as accurate as the photographed portion estimate,
ingredient identification, cooking-state match, and source record. Scranbook
therefore presents the result as an editable rough estimate and does not make
medical, allergy, or food-safety claims.
