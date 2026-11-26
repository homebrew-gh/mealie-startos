import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RECIPE_UPDATE_SUBJECT,
  buildMealieInstructions,
  ensureIngredientReferenceIds,
  formatInstructions,
  groupCookNotes,
  mergeUpdatedIngredients,
  parseServingsNumber,
  propagateSplitStepReferences,
  pruneOrphanedStepReferences,
  recipeGaps,
  unlabeledFoodsForRecipe,
} from '../dist/steps.js'

test('mergeUpdatedIngredients preserves referenceId and parsed fields for unchanged lines', () => {
  const existing = [
    {
      referenceId: 'ref-1',
      quantity: 2,
      unit: { id: 'u1', name: 'cup' },
      food: { id: 'f1', name: 'flour' },
      display: '2 cups flour',
      originalText: '2 cups of flour',
      note: '',
      title: '',
    },
    {
      referenceId: 'ref-2',
      quantity: 1,
      food: { id: 'f2', name: 'salt' },
      display: '1 tsp salt',
      originalText: '1 tsp salt',
      note: '',
      title: '',
    },
  ]
  let seq = 0
  const next = mergeUpdatedIngredients(
    existing,
    ['2 cups flour', '2 tbsp olive oil', '1 tsp salt'],
    ['Dry', undefined, undefined],
    () => `new-${++seq}`,
  )
  assert.equal(next.length, 3)
  // Matched by display, kept referenceId & food, updated section heading
  assert.equal(next[0].referenceId, 'ref-1')
  assert.equal(next[0].food.id, 'f1')
  assert.equal(next[0].title, 'Dry')
  // New line gets fresh referenceId and stays unlinked for parser
  assert.equal(next[1].referenceId, 'new-1')
  assert.equal(next[1].food, undefined)
  assert.equal(next[1].originalText, '2 tbsp olive oil')
  // Reordered unchanged line keeps its original referenceId
  assert.equal(next[2].referenceId, 'ref-2')
  assert.equal(next[2].food.id, 'f2')
})

test('buildMealieInstructions resolves 0-based ingredient indexes and round-trips via formatInstructions', () => {
  const ings = ensureIngredientReferenceIds(
    [{ originalText: '1 lb steak', referenceId: 'r-steak' }, { originalText: '2 tbsp butter' }],
    () => 'r-butter',
  )
  let seq = 0
  const { instructions, invalidIndexes } = buildMealieInstructions(
    [
      'Preheat skillet.',
      {
        title: 'Cook',
        summary: 'Sear the steak',
        text: 'Sear steak in butter for 4 minutes per side.',
        ingredients: [0, 1, 1, 99],
      },
    ],
    ings,
    [{ id: 'step-existing-0' }],
    () => `step-${++seq}`,
  )
  assert.deepEqual(invalidIndexes, [99])
  assert.equal(instructions[0].id, 'step-existing-0')
  assert.deepEqual(instructions[0].ingredientReferences, [])
  assert.equal(instructions[1].title, 'Cook')
  assert.equal(instructions[1].summary, 'Sear the steak')
  assert.deepEqual(instructions[1].ingredientReferences, [
    { referenceId: 'r-steak' },
    { referenceId: 'r-butter' },
  ])

  const formatted = formatInstructions(instructions, ings)
  assert.deepEqual(formatted, [
    {
      index: 0,
      title: undefined,
      summary: undefined,
      text: 'Preheat skillet.',
      ingredients: undefined,
    },
    {
      index: 1,
      title: 'Cook',
      summary: 'Sear the steak',
      text: 'Sear steak in butter for 4 minutes per side.',
      ingredients: [0, 1],
    },
  ])
})

test('pruneOrphanedStepReferences removes deleted ingredient references', () => {
  const steps = [
    {
      id: 's1',
      text: 'Mix.',
      ingredientReferences: [{ referenceId: 'r1' }, { referenceId: 'r-deleted' }],
    },
  ]
  const pruned = pruneOrphanedStepReferences(steps, [{ referenceId: 'r1' }])
  assert.ok(pruned)
  assert.deepEqual(pruned[0].ingredientReferences, [{ referenceId: 'r1' }])
  assert.equal(pruneOrphanedStepReferences(pruned, [{ referenceId: 'r1' }]), undefined)
})

test('propagateSplitStepReferences expands references when combined lines split', () => {
  const steps = [
    {
      id: 's1',
      text: 'Season with salt and pepper.',
      ingredientReferences: [{ referenceId: 'r-sp' }],
    },
    { id: 's2', text: 'Rest 5 minutes.', ingredientReferences: [] },
  ]
  const updated = propagateSplitStepReferences(
    steps,
    new Map([['r-sp', ['r-pepper']]]),
  )
  assert.ok(updated)
  assert.deepEqual(updated[0].ingredientReferences, [
    { referenceId: 'r-sp' },
    { referenceId: 'r-pepper' },
  ])
  assert.deepEqual(updated[1].ingredientReferences, [])
})

test('parseServingsNumber extracts leading numeric serving count', () => {
  assert.equal(parseServingsNumber('4 servings'), 4)
  assert.equal(parseServingsNumber('Makes 6 portions'), 6)
  assert.equal(parseServingsNumber('2.5'), 2.5)
  assert.equal(parseServingsNumber('a bunch'), undefined)
  assert.equal(parseServingsNumber(undefined), undefined)
})

test('unlabeledFoodsForRecipe and recipeGaps report actionable missing metadata', () => {
  const labels = [{ id: 'l1', name: 'Produce' }]
  const recipe = {
    recipeCategory: [],
    prepTime: '15 minutes',
    performTime: '',
    image: '',
    recipeIngredient: [
      { originalText: '1 onion', food: { id: 'f1', name: 'onion', labelId: 'l1' } },
      { originalText: '1 tsp cumin', food: { id: 'f2', name: 'cumin' } },
      { originalText: '1/2 tsp cumin', food: { id: 'f2', name: 'cumin' } },
      { originalText: 'splash of water' },
    ],
    recipeInstructions: [{ text: 'Cook everything.', ingredientReferences: [] }],
  }
  const unlabeled = unlabeledFoodsForRecipe(recipe, labels)
  assert.deepEqual(unlabeled, [{ id: 'f2', name: 'cumin' }])
  const gaps = recipeGaps(recipe, {
    unlabeledFoodsCount: unlabeled.length,
    hasNutrition: false,
  })
  assert.deepEqual(gaps, [
    'missing_category',
    'missing_cook_time',
    'missing_image',
    'missing_nutrition',
    '1_unlinked_ingredient',
    '1_unlabeled_food',
    'missing_step_ingredient_links',
  ])
})

test('groupCookNotes classifies reviewed vs pending notes and honors onlyPending', () => {
  const dayOf = (d) => d.toISOString().slice(0, 10)
  const events = [
    // Review recorded AFTER `until` still marks Tuesday's Chili cook as reviewed
    {
      recipeId: 'r-chili',
      eventType: 'info',
      subject: RECIPE_UPDATE_SUBJECT,
      eventMessage: 'Increased simmer 20 -> 30 min',
      at: new Date('2026-11-26T15:00:00Z'),
    },
    // New Friday cook note with no review after it
    {
      recipeId: 'r-pasta',
      eventType: 'comment',
      subject: 'Cook notes',
      eventMessage: '- 6:30 PM, step 2: Sauce was thin',
      at: new Date('2026-11-25T23:30:00Z'),
    },
    // Tuesday Chili cook note
    {
      recipeId: 'r-chili',
      eventType: 'comment',
      subject: 'Cook notes',
      eventMessage: '- 6:15 PM, step 4: Needed 10 more min',
      at: new Date('2026-11-24T23:15:00Z'),
    },
  ]
  const opts = {
    start: new Date('2026-11-24T00:00:00Z'),
    end: new Date('2026-11-26T00:00:00Z'),
    dayOf,
  }
  const all = groupCookNotes(events, opts)
  assert.equal(all.length, 2)
  assert.equal(all[0].recipeId, 'r-pasta')
  assert.equal(all[0].status, 'pending')
  assert.equal(all[0].reviewedAt, undefined)
  assert.equal(all[1].recipeId, 'r-chili')
  assert.equal(all[1].status, 'reviewed')
  assert.equal(all[1].reviewedAt, '2026-11-26T15:00:00.000Z')

  const pendingOnly = groupCookNotes(events, { ...opts, onlyPending: true })
  assert.equal(pendingOnly.length, 1)
  assert.equal(pendingOnly[0].recipeId, 'r-pasta')
})
