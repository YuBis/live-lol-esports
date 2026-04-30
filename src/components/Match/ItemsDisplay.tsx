import { DetailsFrame, Item } from "../types/baseTypes"

import { ITEMS_URL } from "../../utils/LoLEsportsAPI"

type Props = {
    participantId: number,
    lastFrame: DetailsFrame,
    items: Item[],
    patchVersion: string,
    role?: string,
}

export function ItemsDisplay({ participantId, lastFrame, items, patchVersion, role }: Props) {
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
    const constrainedItems = applyRoleNonTrinketItemLimit(itemsID, role, items)

    const itemsUrlWithPatchVersion = ITEMS_URL.replace(`PATCH_VERSION`, patchVersion)

    return (
        <div className="player-stats-items" key={`${participantId}`}>
            {[...Array(7)].map((x, i) => {

                if (constrainedItems[i] !== undefined) {
                    let currentItem = items[constrainedItems[i]]
                    return (
                        <div className="player-stats-item"
                            key={`${participantId}_${i}_${constrainedItems[i]}`}
                            id={`item_${participantId}_${i}_${constrainedItems[i]}`}
                            onMouseEnter={() => showItemDescription(`item_${participantId}_${i}_${constrainedItems[i]}`)}
                            onMouseLeave={() => hideItemDescription(`item_${participantId}_${i}_${constrainedItems[i]}`)}
                            onTouchStart={() => showItemDescription(`item_${participantId}_${i}_${constrainedItems[i]}`)}
                            onTouchEnd={() => hideItemDescription(`item_${participantId}_${i}_${constrainedItems[i]}`)}>
                            <div className="itemDescription">
                                <div className="itemName">{currentItem.name}</div>
                                {formatItemDescription(currentItem)}
                            </div>
                            <img alt="" src={`${itemsUrlWithPatchVersion}${constrainedItems[i]}.png`} />
                        </div>
                    )
                } else {
                    return (
                        <div className="player-stats-item empty" key={`${participantId}_${i}_${constrainedItems[i]}`} />
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
const BOOT_ITEM_IDS = [
    1001,
    3005,
    3006,
    3009,
    3010,
    3013,
    3020,
    3047,
    3111,
    3117,
    3158,
    3170,
    3171,
    3172,
    3173,
    3174,
    3175,
    3176,
]
const BOOT_ITEM_PREFERENCE_ORDER = BOOT_ITEM_IDS.slice().reverse()
const CONTROL_WARD_ITEM_ID = 2055
const FALLBACK_CONSUMABLE_ITEM_IDS = [
    2003, // Health Potion
    2010, // Biscuit
    2031, // Refillable Potion
    2033, // Corrupting Potion
    2055, // Control Ward
    2138, // Elixir of Iron
    2139, // Elixir of Sorcery
    2140, // Elixir of Wrath
]
const FALLBACK_INSTANT_CONSUMED_ITEM_IDS = [2138, 2139, 2140]
const NON_BOTTOM_SUPPORT_MAX_NON_TRINKET_ITEMS = 6
const DEFAULT_MAX_NON_TRINKET_ITEMS = 7

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

function isInstantConsumedLikelyItem(itemId: number, _items: Item[]) {
    // Control Ward is also flagged as consumed in Data Dragon,
    // but it occupies an inventory slot and should remain visible.
    return FALLBACK_INSTANT_CONSUMED_ITEM_IDS.includes(itemId)
}

function isTrimmableConsumableForOverflow(itemId: number, items: Item[]) {
    if (!isConsumableItem(itemId, items)) return false
    return itemId !== CONTROL_WARD_ITEM_ID
}

function applyRoleNonTrinketItemLimit(itemIds: number[], role: string | undefined, items: Item[]) {
    const maxNonTrinketItems = getMaxNonTrinketItemsForRole(role)
    if (itemIds.length <= maxNonTrinketItems) return itemIds

    let filteredItems = itemIds.slice()
    filteredItems = trimItemsByPriority(filteredItems, maxNonTrinketItems, (itemId) => isInstantConsumedLikelyItem(itemId, items))

    if (filteredItems.length > maxNonTrinketItems) {
        filteredItems = trimItemsByPriority(filteredItems, maxNonTrinketItems, (itemId) => isTrimmableConsumableForOverflow(itemId, items))
    }

    if (filteredItems.length > maxNonTrinketItems) {
        filteredItems = trimItemsByPriority(filteredItems, maxNonTrinketItems, (itemId) => isConsumableItem(itemId, items))
    }

    if (filteredItems.length > maxNonTrinketItems) {
        filteredItems = filteredItems.slice(0, maxNonTrinketItems)
    }

    return ensureBootItemPreserved(itemIds, filteredItems, maxNonTrinketItems)
}

function getMaxNonTrinketItemsForRole(role: string | undefined) {
    const normalizedRole = role?.toLowerCase()
    if (normalizedRole === `top` || normalizedRole === `jungle` || normalizedRole === `mid`) {
        return NON_BOTTOM_SUPPORT_MAX_NON_TRINKET_ITEMS
    }
    return DEFAULT_MAX_NON_TRINKET_ITEMS
}

function trimItemsByPriority(itemIds: number[], maxItems: number, shouldTrimItem: (itemId: number) => boolean) {
    if (itemIds.length <= maxItems) return itemIds

    const retainedItems: number[] = []
    const trimCandidateItems: number[] = []
    itemIds.forEach((itemId) => {
        if (shouldTrimItem(itemId)) {
            trimCandidateItems.push(itemId)
            return
        }
        retainedItems.push(itemId)
    })

    if (retainedItems.length >= maxItems) {
        return retainedItems.slice(0, maxItems)
    }

    const remainingSlots = maxItems - retainedItems.length
    return retainedItems.concat(trimCandidateItems.slice(0, remainingSlots))
}

function ensureBootItemPreserved(
    sourceItemIds: number[],
    constrainedItemIds: number[],
    maxItems: number,
) {
    const sourceBootItemId = getPreferredBootItemId(sourceItemIds)
    if (sourceBootItemId === undefined) return constrainedItemIds

    const constrainedHasBoot = constrainedItemIds.some((itemId) => BOOT_ITEM_IDS.includes(itemId))
    if (constrainedHasBoot) return constrainedItemIds

    if (constrainedItemIds.length < maxItems) {
        return [...constrainedItemIds, sourceBootItemId]
    }

    if (constrainedItemIds.length === 0) return [sourceBootItemId]

    const bootPreservedItems = constrainedItemIds.slice()
    bootPreservedItems[bootPreservedItems.length - 1] = sourceBootItemId
    return bootPreservedItems
}

function getPreferredBootItemId(itemIds: number[]) {
    return BOOT_ITEM_PREFERENCE_ORDER.find((itemId) => itemIds.includes(itemId))
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
