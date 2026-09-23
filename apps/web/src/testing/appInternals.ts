// Temporary characterization seam for private App helpers, removed after extraction.
import {readFileSync} from "node:fs";
import ts from "typescript";

export function appInternals(names:string[],bindings:Record<string,unknown>={}) {
  const path=new URL("../App.tsx",import.meta.url);
  const source=ts.createSourceFile(path.pathname,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name&&names.includes(node.name.text));
  if(declarations.length!==names.length)throw new Error("Missing App characterization target");
  const code=ts.transpileModule(declarations.map(node=>node.getText(source)).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function(...Object.keys(bindings),`${code}\nreturn {${names.join(",")}};`)(...Object.values(bindings));
}
