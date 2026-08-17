const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const TABS = [
  { key: 'randomizer', label: 'Pick a meal' },
  { key: 'recipes', label: 'Recipes' },
  { key: 'pantry', label: 'Pantry' },
  { key: 'plan', label: 'Plan' },
  { key: 'shopping', label: 'Shopping' },
]
const CATEGORIES = ['protein', 'produce', 'dairy', 'pantry', 'spice', 'other']

let currentTab = 'randomizer'
let recipeFormSelected = {} // ingredientId -> quantity, while the new-recipe form is open

function renderTabs() {
  const tabsEl = document.getElementById('tabs')
  tabsEl.innerHTML = TABS.map(
    (t) => `<button class="${t.key === currentTab ? 'active' : ''}" onclick="showTab('${t.key}')">${t.label}</button>`
  ).join('')
}

function showTab(key) {
  currentTab = key
  renderTabs()
  render()
}

function render() {
  if (currentTab === 'randomizer') renderRandomizer()
  if (currentTab === 'recipes') renderRecipes()
  if (currentTab === 'pantry') renderPantry()
  if (currentTab === 'plan') renderPlan()
  if (currentTab === 'shopping') renderShopping()
}

function card(inner) {
  return `<div class="card"><div class="punch"></div><div class="card-body">${inner}</div></div>`
}

function pill(text, tone) {
  return `<span class="pill ${tone}">${text}</span>`
}

// ---------- PANTRY ----------
async function renderPantry() {
  const main = document.getElementById('main')
  main.innerHTML = '<p class="muted">Loading pantry…</p>'

  const { data: ingredients } = await client.from('ingredients').select('*').order('category').order('name')
  const { data: pantry } = await client.from('pantry').select('*')
  const pantryMap = {}
  ;(pantry || []).forEach((p) => (pantryMap[p.ingredient_id] = p.have_it))

  const grouped = CATEGORIES.map((cat) => ({
    cat,
    items: (ingredients || []).filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0)

  let html = card(`
    <h2 class="display">What's in the house</h2>
    <p class="muted" style="font-size:13px;margin:0 0 16px;">Tap an ingredient to mark it as have / don't have. This drives "what can we make."</p>
    <form class="row" style="margin-bottom:20px;" onsubmit="addIngredient(event)">
      <input id="new-ingredient-name" placeholder="Add an ingredient…" style="flex:1;min-width:160px;" />
      <select id="new-ingredient-category">
        ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
      </select>
      <button type="submit" class="dark">Add</button>
    </form>
  `)

  grouped.forEach((g) => {
    html += `<div style="margin-bottom:16px;">
      <div class="mono muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">${g.cat}</div>
      <div class="row">
        ${g.items
          .map((item) => {
            const have = !!pantryMap[item.id]
            return `<span class="chip ${have ? 'have' : ''}" onclick="toggleHave('${item.id}', ${have})">${have ? '✓ ' : ''}${escapeHtml(item.name)}</span>`
          })
          .join('')}
      </div>
    </div>`
  })

  main.innerHTML = html
}

async function toggleHave(ingredientId, current) {
  await client.from('pantry').upsert({
    ingredient_id: ingredientId,
    have_it: !current,
    updated_at: new Date().toISOString(),
  })
  renderPantry()
}

async function addIngredient(e) {
  e.preventDefault()
  const nameInput = document.getElementById('new-ingredient-name')
  const categorySelect = document.getElementById('new-ingredient-category')
  const name = nameInput.value.trim()
  if (!name) return
  await client.from('ingredients').insert({ name, category: categorySelect.value })
  renderPantry()
}

// ---------- RECIPES ----------
async function renderRecipes(showForm) {
  const main = document.getElementById('main')
  main.innerHTML = '<p class="muted">Loading recipes…</p>'

  const [{ data: recipes }, { data: ingredients }, { data: pantry }, { data: lastCooked }, { data: recipeIngredients }] =
    await Promise.all([
      client.from('recipes').select('*').order('name'),
      client.from('ingredients').select('*').order('name'),
      client.from('pantry').select('*'),
      client.from('recipe_last_cooked').select('*'),
      client.from('recipe_ingredients').select('*'),
    ])

  const pantryMap = {}
  ;(pantry || []).forEach((p) => (pantryMap[p.ingredient_id] = p.have_it))
  const lastCookedMap = {}
  ;(lastCooked || []).forEach((r) => (lastCookedMap[r.recipe_id] = r.last_cooked))

  function missingFor(recipeId) {
    return (recipeIngredients || [])
      .filter((ri) => ri.recipe_id === recipeId && !pantryMap[ri.ingredient_id])
      .map((ri) => (ingredients || []).find((i) => i.id === ri.ingredient_id)?.name)
      .filter(Boolean)
  }

  let html = `<div class="row" style="justify-content:space-between;margin-bottom:12px;">
    <h2 class="display" style="margin:0;">Recipe box</h2>
    <button class="primary" onclick="toggleRecipeForm()">${showForm ? 'Close' : '+ New recipe'}</button>
  </div>`

  if (showForm) {
    html += card(`
      <form onsubmit="submitRecipe(event)" class="space-y">
        <input id="recipe-name" placeholder="Recipe name" required style="width:100%;" />
        <textarea id="recipe-instructions" placeholder="Instructions" rows="3" style="width:100%;"></textarea>
        <div class="row">
          <input id="recipe-prep-minutes" type="number" placeholder="Prep minutes" style="width:130px;" />
          <input id="recipe-tags" placeholder="Tags, comma separated" style="flex:1;" />
        </div>
        <div>
          <p class="mono muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Ingredients used</p>
          <div class="row" id="recipe-ingredient-picker">
            ${(ingredients || [])
              .map((i) => {
                const selected = i.id in recipeFormSelected
                return `<span class="chip ${selected ? 'have' : ''}" onclick="toggleRecipeIngredient('${i.id}')">${escapeHtml(i.name)}</span>
                  ${selected ? `<input value="${escapeHtml(recipeFormSelected[i.id] || '')}" oninput="setRecipeIngredientQty('${i.id}', this.value)" placeholder="qty" style="width:60px;font-size:12px;padding:6px 8px;" />` : ''}`
              })
              .join('')}
          </div>
        </div>
        <button type="submit" class="secondary">Save recipe</button>
      </form>
    `)
  }

  ;(recipes || []).forEach((r) => {
    const missing = missingFor(r.id)
    const canMake = missing.length === 0
    const last = lastCookedMap[r.id]
    html += card(`
      <div class="row" style="justify-content:space-between;align-items:flex-start;">
        <h3 class="display" style="font-size:16px;">${escapeHtml(r.name)}</h3>
        ${pill(canMake ? 'can make' : `missing ${missing.length}`, canMake ? 'sage' : 'rust')}
      </div>
      <p class="mono muted" style="font-size:11px;margin:4px 0 0;">
        ${last ? `last made ${last}` : 'never made yet'}${r.prep_minutes ? ` · ${r.prep_minutes} min` : ''}
      </p>
      ${!canMake ? `<p style="font-size:12px;color:#8F3E22;margin-top:8px;">Need: ${missing.join(', ')}</p>` : ''}
      ${r.instructions ? `<p style="font-size:13px;margin-top:10px;white-space:pre-wrap;">${escapeHtml(r.instructions)}</p>` : ''}
      <button class="dark" style="margin-top:10px;" onclick="logCookedFromRecipe('${r.id}')">Mark cooked today</button>
    `)
  })

  if (!recipes || recipes.length === 0) {
    html += '<p class="muted" style="font-size:14px;">No recipes yet — add your first one above.</p>'
  }

  main.innerHTML = html
}

function toggleRecipeForm() {
  recipeFormSelected = {}
  const isOpen = document.getElementById('recipe-ingredient-picker') !== null
  renderRecipes(!isOpen)
}

function toggleRecipeIngredient(id) {
  if (id in recipeFormSelected) delete recipeFormSelected[id]
  else recipeFormSelected[id] = ''
  renderRecipes(true)
}

function setRecipeIngredientQty(id, value) {
  recipeFormSelected[id] = value
}

async function submitRecipe(e) {
  e.preventDefault()
  const name = document.getElementById('recipe-name').value.trim()
  if (!name) return
  const instructions = document.getElementById('recipe-instructions').value
  const prepMinutes = document.getElementById('recipe-prep-minutes').value
  const tags = document
    .getElementById('recipe-tags')
    .value.split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const { data: recipe, error } = await client
    .from('recipes')
    .insert({
      name,
      instructions,
      prep_minutes: prepMinutes ? parseInt(prepMinutes, 10) : null,
      tags,
    })
    .select()
    .single()

  if (!error && recipe) {
    const rows = Object.entries(recipeFormSelected).map(([ingredient_id, quantity]) => ({
      recipe_id: recipe.id,
      ingredient_id,
      quantity,
    }))
    if (rows.length) await client.from('recipe_ingredients').insert(rows)
  }
  recipeFormSelected = {}
  renderRecipes(false)
}

async function logCookedFromRecipe(recipeId) {
  await client.from('cook_log').insert({ recipe_id: recipeId, cooked_on: new Date().toISOString().slice(0, 10) })
  renderRecipes(false)
}

// ---------- RANDOMIZER ----------
let randomizerOnlyCanMake = true
let randomizerPick = null

async function renderRandomizer() {
  const main = document.getElementById('main')
  main.innerHTML = '<p class="muted">Shuffling the deck…</p>'

  const [{ data: recipes }, { data: pantry }, { data: recipeIngredients }, { data: lastCooked }] = await Promise.all([
    client.from('recipes').select('*'),
    client.from('pantry').select('*'),
    client.from('recipe_ingredients').select('*'),
    client.from('recipe_last_cooked').select('*'),
  ])

  const pantryMap = {}
  ;(pantry || []).forEach((p) => (pantryMap[p.ingredient_id] = p.have_it))
  const lastCookedMap = {}
  ;(lastCooked || []).forEach((r) => (lastCookedMap[r.recipe_id] = r.last_cooked))

  window.__randomizerRecipes = (recipes || []).map((r) => {
    const need = (recipeIngredients || []).filter((ri) => ri.recipe_id === r.id)
    const canMake = need.every((n) => pantryMap[n.ingredient_id])
    return { ...r, canMake, lastCooked: lastCookedMap[r.id] || null }
  })

  drawRandomizer()
}

function drawRandomizer() {
  const main = document.getElementById('main')
  let pickHtml = ''
  if (randomizerPick === 'none') {
    pickHtml = `<p style="color:#8F3E22;font-size:14px;">Nothing matches — either add recipes or stock the pantry a bit more.</p>`
  } else if (randomizerPick) {
    pickHtml = `
      <div style="border-top:1px solid #D9CDB0;margin-top:16px;padding-top:16px;">
        <h3 class="display" style="font-size:28px;">${escapeHtml(randomizerPick.name)}</h3>
        <p class="mono muted" style="font-size:11px;margin-top:4px;">
          ${randomizerPick.lastCooked ? `last made ${randomizerPick.lastCooked}` : 'never made yet'}
        </p>
        <button class="secondary" style="margin-top:12px;" onclick="logCookedFromRandomizer()">Cooking this — log it</button>
      </div>`
  }

  main.innerHTML = `<div style="max-width:420px;margin:0 auto;text-align:center;">${card(`
    <h2 class="display">What should we eat?</h2>
    <p class="muted" style="font-size:13px;margin:0 0 16px;">Picks favor meals you haven't had in a while.</p>
    <label style="font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px;">
      <input type="checkbox" id="only-can-make" ${randomizerOnlyCanMake ? 'checked' : ''} onchange="setOnlyCanMake(this.checked)" />
      Only suggest what we can make right now
    </label>
    <button class="primary" onclick="rerollRandomizer()">🎲 Pick a meal</button>
    ${pickHtml}
  `)}</div>`
}

function setOnlyCanMake(value) {
  randomizerOnlyCanMake = value
}

function rerollRandomizer() {
  const all = window.__randomizerRecipes || []
  const pool = randomizerOnlyCanMake ? all.filter((r) => r.canMake) : all
  if (pool.length === 0) {
    randomizerPick = 'none'
    drawRandomizer()
    return
  }
  const sorted = [...pool].sort((a, b) => {
    const aDate = a.lastCooked || '0000-00-00'
    const bDate = b.lastCooked || '0000-00-00'
    return aDate < bDate ? -1 : 1
  })
  const weightedPool = sorted.slice(0, Math.max(3, Math.ceil(sorted.length / 2)))
  randomizerPick = weightedPool[Math.floor(Math.random() * weightedPool.length)]
  drawRandomizer()
}

async function logCookedFromRandomizer() {
  if (!randomizerPick || randomizerPick === 'none') return
  await client
    .from('cook_log')
    .insert({ recipe_id: randomizerPick.id, cooked_on: new Date().toISOString().slice(0, 10) })
  randomizerPick = null
  renderRandomizer()
}

// ---------- PLAN ----------
async function renderPlan() {
  const main = document.getElementById('main')
  main.innerHTML = '<p class="muted">Loading the calendar…</p>'

  const { data: recipes } = await client.from('recipes').select('*').order('name')
  const { data: planned } = await client.from('planned_meals').select('*').order('planned_date')

  function recipeName(id) {
    return (recipes || []).find((r) => r.id === id)?.name || 'Unknown recipe'
  }

  const upcoming = (planned || []).filter((p) => p.status === 'planned')
  const past = (planned || []).filter((p) => p.status !== 'planned')

  let html = card(`
    <h2 class="display">Plan ahead</h2>
    <p class="muted" style="font-size:13px;margin:0 0 16px;">Schedule what you'll cook and when.</p>
    <form class="row" onsubmit="addPlanned(event)">
      <select id="plan-recipe" required style="flex:1;min-width:160px;">
        <option value="">Choose a recipe…</option>
        ${(recipes || []).map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
      </select>
      <input type="date" id="plan-date" value="${new Date().toISOString().slice(0, 10)}" />
      <button type="submit" class="secondary">Schedule it</button>
    </form>
  `)

  html += '<h3 class="display" style="font-size:18px;margin:20px 0 8px;">Upcoming</h3>'
  if (upcoming.length === 0) html += '<p class="muted" style="font-size:14px;">Nothing scheduled yet.</p>'
  upcoming.forEach((p) => {
    html += card(`
      <div class="row" style="justify-content:space-between;">
        <div>
          <p style="margin:0;font-weight:500;">${escapeHtml(recipeName(p.recipe_id))}</p>
          <p class="mono muted" style="font-size:11px;margin:2px 0 0;">${p.planned_date}</p>
        </div>
        <div class="row" style="gap:6px;">
          <button class="secondary" onclick="markPlannedStatus('${p.id}', 'cooked')">Cooked</button>
          <button class="outline" onclick="markPlannedStatus('${p.id}', 'skipped')">Skip</button>
          <button class="outline rust-outline" onclick="removePlanned('${p.id}')">✕</button>
        </div>
      </div>
    `)
  })

  if (past.length > 0) {
    html += '<h3 class="display" style="font-size:18px;margin:20px 0 8px;">Recently resolved</h3>'
    past.slice(0, 8).forEach((p) => {
      html += `<div class="row" style="justify-content:space-between;font-size:14px;padding:6px 4px;">
        <span>${escapeHtml(recipeName(p.recipe_id))}</span>
        <span class="mono muted" style="font-size:11px;">${p.planned_date} · ${p.status}</span>
      </div>`
    })
  }

  main.innerHTML = html
}

async function addPlanned(e) {
  e.preventDefault()
  const recipeId = document.getElementById('plan-recipe').value
  const date = document.getElementById('plan-date').value
  if (!recipeId || !date) return
  await client.from('planned_meals').insert({ recipe_id: recipeId, planned_date: date })
  renderPlan()
}

async function markPlannedStatus(id, status) {
  const { data: planned } = await client.from('planned_meals').select('*').eq('id', id).single()
  await client.from('planned_meals').update({ status }).eq('id', id)
  if (status === 'cooked' && planned) {
    await client.from('cook_log').insert({ recipe_id: planned.recipe_id, cooked_on: planned.planned_date })
  }
  renderPlan()
}

async function removePlanned(id) {
  await client.from('planned_meals').delete().eq('id', id)
  renderPlan()
}

// ---------- SHOPPING LIST ----------
async function renderShopping() {
  const main = document.getElementById('main')
  main.innerHTML = '<p class="muted">Loading list…</p>'

  const [{ data: items }, { data: ingredients }] = await Promise.all([
    client.from('shopping_list').select('*').order('checked').order('created_at'),
    client.from('ingredients').select('*').order('name'),
  ])

  function ingredientName(id) {
    return (ingredients || []).find((i) => i.id === id)?.name || 'Item'
  }

  const unchecked = (items || []).filter((i) => !i.checked)
  const checked = (items || []).filter((i) => i.checked)

  let html = card(`
    <h2 class="display">Shopping list</h2>
    <p class="muted" style="font-size:13px;margin:0 0 16px;">Add things you're out of, or auto-fill from what's missing for planned meals.</p>
    <form class="row" onsubmit="addShoppingItem(event)" style="margin-bottom:12px;">
      <select id="shopping-ingredient" required style="flex:1;min-width:140px;">
        <option value="">Add ingredient…</option>
        ${(ingredients || []).map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')}
      </select>
      <input id="shopping-note" placeholder="note (optional)" style="width:130px;" />
      <button type="submit" class="secondary">Add</button>
    </form>
    <button class="outline rust-outline" onclick="fillFromPlannedMeals()">+ Add what's missing for planned meals</button>
  `)

  if (unchecked.length === 0 && checked.length === 0) {
    html += '<p class="muted" style="font-size:14px;">List is empty — nice.</p>'
  }

  unchecked.forEach((item) => {
    html += `<div class="row" style="justify-content:space-between;padding:6px 2px;">
      <label class="row" style="font-size:14px;gap:8px;">
        <input type="checkbox" onchange="toggleShoppingChecked('${item.id}', false)" />
        ${escapeHtml(ingredientName(item.ingredient_id))}
        ${item.note ? `<span class="muted" style="font-size:12px;">· ${escapeHtml(item.note)}</span>` : ''}
      </label>
      <button class="outline rust-outline" onclick="removeShoppingItem('${item.id}')">✕</button>
    </div>`
  })

  if (checked.length > 0) {
    html += '<div style="border-top:1px solid #D9CDB0;margin-top:12px;padding-top:12px;">'
    checked.forEach((item) => {
      html += `<div class="row" style="justify-content:space-between;padding:6px 2px;opacity:.5;">
        <label class="row" style="font-size:14px;gap:8px;text-decoration:line-through;">
          <input type="checkbox" checked onchange="toggleShoppingChecked('${item.id}', true)" />
          ${escapeHtml(ingredientName(item.ingredient_id))}
        </label>
        <button class="outline rust-outline" onclick="removeShoppingItem('${item.id}')">✕</button>
      </div>`
    })
    html += '</div>'
  }

  main.innerHTML = html
}

async function addShoppingItem(e) {
  e.preventDefault()
  const ingredientId = document.getElementById('shopping-ingredient').value
  const note = document.getElementById('shopping-note').value
  if (!ingredientId) return
  await client.from('shopping_list').insert({ ingredient_id: ingredientId, note })
  renderShopping()
}

async function toggleShoppingChecked(id, current) {
  await client.from('shopping_list').update({ checked: !current }).eq('id', id)
  renderShopping()
}

async function removeShoppingItem(id) {
  await client.from('shopping_list').delete().eq('id', id)
  renderShopping()
}

async function fillFromPlannedMeals() {
  const { data: planned } = await client.from('planned_meals').select('*').eq('status', 'planned')
  if (!planned || planned.length === 0) return
  const recipeIds = planned.map((p) => p.recipe_id)
  const { data: recipeIngredients } = await client.from('recipe_ingredients').select('*').in('recipe_id', recipeIds)
  const { data: pantry } = await client.from('pantry').select('*')
  const { data: existingItems } = await client.from('shopping_list').select('*')

  const haveMap = {}
  ;(pantry || []).forEach((p) => (haveMap[p.ingredient_id] = p.have_it))
  const alreadyOnList = new Set((existingItems || []).map((i) => i.ingredient_id))
  const missingIds = [
    ...new Set((recipeIngredients || []).filter((x) => !haveMap[x.ingredient_id]).map((x) => x.ingredient_id)),
  ]
  const toAdd = missingIds.filter((id) => !alreadyOnList.has(id))
  if (toAdd.length === 0) return
  await client
    .from('shopping_list')
    .insert(toAdd.map((ingredient_id) => ({ ingredient_id, note: 'for planned meal' })))
  renderShopping()
}

// ---------- utility ----------
function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

renderTabs()
render()
