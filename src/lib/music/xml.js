const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x'
      const number = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10)
      return Number.isFinite(number) ? String.fromCodePoint(number) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function localName(name) {
  const value = String(name ?? '')
  return value.includes(':') ? value.slice(value.indexOf(':') + 1) : value
}

export function child(node, name) {
  if (!node) return null
  const wanted = localName(name)
  return node.children.find((entry) => localName(entry.name) === wanted) ?? null
}

export function children(node, name) {
  if (!node) return []
  const wanted = localName(name)
  return node.children.filter((entry) => localName(entry.name) === wanted)
}

export function descendants(node, name) {
  if (!node) return []
  const wanted = localName(name)
  const found = []
  const stack = [...node.children]
  while (stack.length) {
    const current = stack.shift()
    if (localName(current.name) === wanted) found.push(current)
    stack.unshift(...current.children)
  }
  return found
}

export function childText(node, name) {
  const found = child(node, name)
  return found ? found.text.trim() : ''
}

export function hasChild(node, name) {
  return Boolean(child(node, name))
}

export function parseXml(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '')
  const root = { name: '#document', attrs: {}, children: [], text: '' }
  const stack = [root]
  let index = 0

  const appendText = (value) => {
    if (!value) return
    stack[stack.length - 1].text += decodeEntities(value)
  }

  while (index < text.length) {
    const lt = text.indexOf('<', index)
    if (lt < 0) {
      appendText(text.slice(index))
      break
    }
    if (lt > index) appendText(text.slice(index, lt))

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      index = end < 0 ? text.length : end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9)
      const content = end < 0 ? text.slice(lt + 9) : text.slice(lt + 9, end)
      stack[stack.length - 1].text += content
      index = end < 0 ? text.length : end + 3
      continue
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2)
      index = end < 0 ? text.length : end + 2
      continue
    }
    if (text.startsWith('<!', lt)) {
      let depth = 0
      let cursor = lt + 2
      for (; cursor < text.length; cursor += 1) {
        if (text[cursor] === '[') depth += 1
        else if (text[cursor] === ']') depth = Math.max(0, depth - 1)
        else if (text[cursor] === '>' && depth === 0) break
      }
      index = cursor >= text.length ? text.length : cursor + 1
      continue
    }

    const gt = text.indexOf('>', lt + 1)
    if (gt < 0) break
    const raw = text.slice(lt + 1, gt).trim()
    index = gt + 1
    if (!raw) continue

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim()
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (localName(stack[i].name) === localName(name)) {
          stack.length = i
          break
        }
      }
      continue
    }

    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1).trim() : raw
    const match = body.match(/^([^\s/>]+)/)
    if (!match) continue
    const name = match[1]
    const attrs = {}
    const attrText = body.slice(match[0].length)
    const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    let attrMatch
    while ((attrMatch = attrRe.exec(attrText))) {
      attrs[localName(attrMatch[1])] = decodeEntities(attrMatch[2] ?? attrMatch[3] ?? '')
    }
    const node = { name, attrs, children: [], text: '' }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }

  const [first] = root.children
  return first || root
}
