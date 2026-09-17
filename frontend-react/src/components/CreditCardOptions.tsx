import type { Account } from '../services/api'

export default function CreditCardOptions({ cards }: { cards: Account[] }) {
  const jaqueCards = cards.filter(card => /\bjaque(?:line)?\b/i.test(card.name))
  const dougCards = cards.filter(card => !/\bjaque(?:line)?\b/i.test(card.name))

  return (
    <>
      {[
        { owner: 'Doug', cards: dougCards },
        { owner: 'Jaque', cards: jaqueCards },
      ].map(group => group.cards.length > 0 && (
        <optgroup key={group.owner} label={`💳 Credit Cards — ${group.owner}`}>
          {group.cards.map(card => (
            <option key={card.id} value={card.id}>{card.name} ({card.bank})</option>
          ))}
        </optgroup>
      ))}
    </>
  )
}
