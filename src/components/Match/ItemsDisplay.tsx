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
    const itemsID = Array.from(new Set(lastFrameItems)).sort(sortItems);

    if (itemsID[0] !== undefined && (itemsID[0] === 3340 || itemsID[0] === 3363 || itemsID[0] === 3364)) {
        trinket = itemsID.shift() as number;
    }

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

const sortItems = (a: number, b: number) => { // (3364, 3363, 3340) id das wards | 3513 id do arauto
    if (a === 3364 || a === 3363 || a === 3340 || a === 3513) return -1;
    if (b === 3364 || b === 3363 || b === 3340 || a === 3513) return 1;

    //return (a > b ? 1 : -1);
    return b - a;
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
