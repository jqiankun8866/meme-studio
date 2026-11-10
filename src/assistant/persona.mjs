// Narrow adapter: no DSH persona or unrelated assistant tables.
export function effectivePersona(db){
 const row=db.prepare("SELECT value FROM studio_settings WHERE key='frequency'").get();
 return {meme:row?JSON.parse(row.value):'high'};
}
