import { DetailsFrame, Item } from "../types/baseTypes"

import { ITEMS_URL } from "../../utils/LoLEsportsAPI"

type Props = {
    participantId: number,
    lastFrame: DetailsFrame,
    items: Item[],
    patchVersion: string
}

export function ItemsDisplay({ participantId, lastFrame, items, patchVersion }: Props) {
    const lastFrameItems = lastFrame.participants[participantId].items;

    /*
        A api da riot não nos retorna nada sobre o arauto, quando
        um jogador pega o arauto sua trinket some para sempre (a
        menos que ele retorne na base e compre outra), assim podemos
        supor que o jogador pegou o arauto

    Update:
        Infelizmente por todo o projeto ser client side o jogador
        sempre estará com arauto, futuramente se fomos fazer algo
        a logica do arauto poderá ser implementada server-side,
        retirando o arauto após 240s
    */

    /*if (!(items.includes(3340) || items.includes(3363) || items.includes(3364))) {
        items.push(3513); // Supondo que o jogador que não possui ward está com arauto
    }*/

    let trinket = -1;
    const itemIds = dedupeConsumableItems(lastFrameItems, items)
    const foundTrinket = itemIds.find((itemId) => TRINKET_IDS.includes(itemId))
    if (foundTrinket !== undefined) {
        trinket = foundTrinket
    }

    const itemsID = itemIds
        .filter((itemId) => !TRINKET_IDS.includes(itemId))
        .sort((a, b) => sortItemsByGoldDesc(a, b, items))

    const itemsUrlWithPatchVersion = ITEMS_URL.replace(`PATCH_VERSION`, patchVersion)

    return (
        <div className="player-stats-items" key={`${participantId}`}>
            {[...Array(7)].map((x, i) => {

                if (itemsID[i] !== undefined) {
                    let currentItem = items[itemsID[i]]
                    return (
                        <div className="player-stats-item"
                            key={`${participantId}_${i}_${itemsID[i]}`}
                            id={`item_${participantId}_${i}_${itemsID[i]}`}
                            onMouseEnter={() => showItemDescription(`item_${participantId}_${i}_${itemsID[i]}`)}
                            onMouseLeave={() => hideItemDescription(`item_${participantId}_${i}_${itemsID[i]}`)}
                            onTouchStart={() => showItemDescription(`item_${participantId}_${i}_${itemsID[i]}`)}
                            onTouchEnd={() => hideItemDescription(`item_${participantId}_${i}_${itemsID[i]}`)}>
                            <div className="itemDescription">
                                <div className="itemName">{currentItem.name}</div>
                                {formatItemDescription(currentItem)}
                            </div>
                            <img alt="" src={`${itemsUrlWithPatchVersion}${itemsID[i]}.png`} />
                        </div>
                    )
                } else {
                    return (
                        <div className="player-stats-item empty" key={`${participantId}_${i}_${itemsID[i]}`} />
                    )
                }

            })
            }


            {trinket !== -1 ?
                (
                    <div className="player-stats-item">
                        <img alt="" src={`${itemsUrlWithPatchVersion}${trinket}.png`} />
                    </div>
                )
                :
                (
                    <div className="player-stats-item empty" />
                )
            }

        </div>
    );
}

/*
    (3364, 3363, 3340) são os ids das trinkets (wards)
    para verificar se um jogar pegou o arauto, basicamente
    vemos se o jogador não possui nenhuma trinket, logo
    adicionamos o id 3513 (arauto) ao seus itens
 */

const TRINKET_IDS = [3340, 3363, 3364]
const FALLBACK_CONSUMABLE_ITEM_IDS = [
    2003, // Health Potion
    2010, // Biscuit
    2031, // Refillable Potion
    2033, // Corrupting Potion
    2055, // Control Ward
]

function dedupeConsumableItems(itemIds: number[], items: Item[]) {
    const dedupedItems: number[] = []
    const seenConsumables = new Set<number>()

    itemIds.forEach((itemId) => {
        if (!isConsumableItem(itemId, items)) {
            dedupedItems.push(itemId)
            return
        }

        if (seenConsumables.has(itemId)) return
        seenConsumables.add(itemId)
        dedupedItems.push(itemId)
    })

    return dedupedItems
}

function isConsumableItem(itemId: number, items: Item[]) {
    const item = items[itemId]
    if (!item) return FALLBACK_CONSUMABLE_ITEM_IDS.includes(itemId)

    if (item.consumed) return true
    if (item.tags && item.tags.includes("Consumable")) return true
    return FALLBACK_CONSUMABLE_ITEM_IDS.includes(itemId)
}

function sortItemsByGoldDesc(a: number, b: number, items: Item[]) {
    const goldA = getItemTotalGold(a, items)
    const goldB = getItemTotalGold(b, items)
    if (goldA !== goldB) return goldB - goldA

    // Deterministic fallback when both items have the same total gold.
    return b - a
}

function getItemTotalGold(itemId: number, items: Item[]) {
    const totalGold = items[itemId]?.gold?.total
    const numericValue = Number(totalGold)
    return Number.isFinite(numericValue) ? numericValue : 0
}

function formatItemDescription(item: Item) {
    let splitDescription = item.description.split(`<li>`).join(`<br>`).split(`<br>`)
    return splitDescription.map(description => {
        return (
            <div>{description.replaceAll(/<\/\w+>/gi, ``).replaceAll(/<\w+>/gi, ``)}</div>
        )
    })
}

function showItemDescription(elementId: string) {
    $(`#${elementId} .itemDescription`).show()
}

function hideItemDescription(elementId: string) {
    $(`#${elementId} .itemDescription`).hide()
}
