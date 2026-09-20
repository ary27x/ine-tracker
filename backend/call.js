import fs from "fs";

let allProducts = [];

for (let page = 1; page <= 17; page++) {
    const response = await fetch(
        `https://demo.inelabteamdev.com/api/catalog?page=${page}&pageSize=60`
    );

    const data = await response.json();

    allProducts.push(...data.items);
}

fs.writeFileSync(
    "all_catalogue.json",
    JSON.stringify(allProducts, null, 2)
);

console.log(`Saved ${allProducts.length} products to all_catalogue.json`);