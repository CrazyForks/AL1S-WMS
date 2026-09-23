import {z} from "zod";

/** Ignore inapplicable input before validation, including malformed forced values. */
export function openedShelfLife(consumptionType:unknown,value:unknown):number|null {
  return consumptionType==="long_term_consumable"
    ? z.number().int().positive().nullable().optional().parse(value)??null
    : null;
}

export function normalizeConsumptionInput(raw:unknown,currentType:unknown="consumable"):unknown {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return raw;
  const input=raw as Record<string,unknown>;
  if(Object.keys(input).length===0)return input;
  const type=input.consumptionType??currentType;
  return type==="long_term_consumable"?input:{...input,openedShelfLifeDays:null};
}
