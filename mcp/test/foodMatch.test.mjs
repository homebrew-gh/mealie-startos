import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractCoreFood,
  findDuplicateFoodGroups,
  findFoodInList,
  isGoodFoodMatch,
  normalizeFoodKey,
  ownFoodTextForLine,
} from '../dist/foodMatch.js'

test('normalizeFoodKey handles hyphens, plurals, and non-plural -us/-ss words', () => {
  assert.equal(normalizeFoodKey('All-Purpose Flour'), 'all purpose flour')
  assert.equal(normalizeFoodKey('Yellow Onions'), 'yellow onion')
  assert.equal(normalizeFoodKey('Cherry Tomatoes'), 'cherry tomato')
  assert.equal(normalizeFoodKey('Blackberries'), 'blackberry')
  assert.equal(normalizeFoodKey('Hummus'), 'hummus')
  assert.equal(normalizeFoodKey('Asparagus'), 'asparagus')
})

test('extractCoreFood strips quantities, units, notes, and leading size/prep words', () => {
  assert.equal(
    extractCoreFood('3 large finely chopped yellow onions, divided', 'divided'),
    'yellow onions',
  )
  assert.equal(
    extractCoreFood('1 lb boneless skinless chicken thighs, trimmed', 'trimmed'),
    'chicken thighs',
  )
  assert.equal(
    extractCoreFood('2 tbsp fresh cilantro, chopped', 'chopped'),
    'cilantro',
  )
  assert.equal(
    extractCoreFood('1 (15 oz) can black beans, drained and rinsed', 'drained and rinsed'),
    'black beans',
  )
  assert.equal(
    extractCoreFood('2 tbsp room temperature unsalted butter'),
    'unsalted butter',
  )
})

test('isGoodFoodMatch blocks false fuzzy matches and accepts aliases and safe qualifiers', () => {
  // Reject bad fuzzy matches even when the matched name is a substring
  assert.equal(isGoodFoodMatch('1 oz simple syrup', { name: 'maple syrup' }), false)
  assert.equal(
    ownFoodTextForLine('1 oz simple syrup', { name: 'maple syrup' }),
    'simple syrup',
  )
  assert.equal(isGoodFoodMatch('1 cup peanut butter', { name: 'butter' }), false)
  assert.equal(
    ownFoodTextForLine('1 cup peanut butter', { name: 'butter' }),
    'peanut butter',
  )
  assert.equal(isGoodFoodMatch('1 cup chicken broth', { name: 'chicken' }), false)
  assert.equal(isGoodFoodMatch('1 tbsp olive oil', { name: 'olive' }), false)
  assert.equal(isGoodFoodMatch('1/2 tsp red pepper flakes', { name: 'pepper' }), false)

  // Accept safe qualifiers with matching head noun
  assert.equal(isGoodFoodMatch('2 tbsp unsalted butter', { name: 'butter' }), true)
  assert.equal(
    isGoodFoodMatch('2 tbsp extra-virgin olive oil', { name: 'olive oil' }),
    true,
  )
  assert.equal(isGoodFoodMatch('1 tsp kosher salt', { name: 'salt' }), true)

  // Accept Mealie aliases and plural/hyphen variants
  assert.equal(
    isGoodFoodMatch('4 scallions, sliced', {
      name: 'green onion',
      aliases: [{ name: 'scallion' }],
    }),
    true,
  )
  assert.equal(
    isGoodFoodMatch('2 cups all-purpose flour', { name: 'all purpose flour' }),
    true,
  )
})

test('findFoodInList matches name, plural, abbreviation, alias, and normalized key', () => {
  const catalog = [
    { id: '1', name: 'green onion', aliases: [{ name: 'scallions' }, { name: 'spring onion' }] },
    { id: '2', name: 'all-purpose flour' },
    { id: '3', name: 'cherry tomato' },
  ]
  assert.equal(findFoodInList('scallion', catalog)?.id, '1')
  assert.equal(findFoodInList('Spring Onions', catalog)?.id, '1')
  assert.equal(findFoodInList('all purpose flour', catalog)?.id, '2')
  assert.equal(findFoodInList('cherry tomatoes', catalog)?.id, '3')
  assert.equal(findFoodInList('peanut butter', catalog), undefined)
})

test('findDuplicateFoodGroups clusters exact normalized and qualifier variants without conflating distinct foods', () => {
  const catalog = [
    { id: '1', name: 'onion' },
    { id: '2', name: 'onions' },
    { id: '3', name: 'butter' },
    { id: '4', name: 'unsalted butter' },
    { id: '5', name: 'peanut butter' },
    { id: '6', name: 'all-purpose flour' },
    { id: '7', name: 'all purpose flour' },
  ]
  const groups = findDuplicateFoodGroups(catalog)
  const onionGroup = groups.find((g) => g.key === 'onion')
  assert.equal(onionGroup?.reason, 'exact_normalized')
  assert.equal(onionGroup?.foods.length, 2)

  const flourGroup = groups.find((g) => g.key === 'all purpose flour')
  assert.equal(flourGroup?.reason, 'exact_normalized')
  assert.equal(flourGroup?.foods.length, 2)

  const butterGroup = groups.find((g) => g.key === 'butter')
  assert.equal(butterGroup?.reason, 'qualifier_variant')
  assert.deepEqual(
    butterGroup?.foods.map((f) => f.name).sort(),
    ['butter', 'unsalted butter'],
  )
})
