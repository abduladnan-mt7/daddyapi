// Code escape-hatch for the books-rated spec.
// Demonstrates the two hook kinds: a custom field transform and a resource
// post-processor — for the things a declarative spec can't express.

const WORD_TO_NUMBER = { one: 1, two: 2, three: 3, four: 4, five: 5 };

export const transforms = {
  // books.toscrape encodes the rating in a class: "star-rating Three" -> 3
  rating: (value) => {
    const word = String(value).replace(/star-rating/i, '').trim().toLowerCase();
    return WORD_TO_NUMBER[word] ?? null;
  },
};

export const postProcess = {
  // Return the catalogue sorted cheapest-first.
  sortByPrice: (rows) =>
    Array.isArray(rows)
      ? [...rows].sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
      : rows,
};
