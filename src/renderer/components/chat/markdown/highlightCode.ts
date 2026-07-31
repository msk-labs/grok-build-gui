import hljsCore from "highlight.js/lib/core";
import arduino from "highlight.js/lib/languages/arduino";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import latex from "highlight.js/lib/languages/latex";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import mathematica from "highlight.js/lib/languages/mathematica";
import matlab from "highlight.js/lib/languages/matlab";
import nginx from "highlight.js/lib/languages/nginx";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import pgsql from "highlight.js/lib/languages/pgsql";
import php from "highlight.js/lib/languages/php";
import phpTemplate from "highlight.js/lib/languages/php-template";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import pythonRepl from "highlight.js/lib/languages/python-repl";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import vbnet from "highlight.js/lib/languages/vbnet";
import wasm from "highlight.js/lib/languages/wasm";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { LanguageFn } from "highlight.js";

const hljs = hljsCore.newInstance();

const languages: Array<[string, LanguageFn]> = [
  ["arduino", arduino],
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["diff", diff],
  ["dockerfile", dockerfile],
  ["dos", dos],
  ["go", go],
  ["graphql", graphql],
  ["ini", ini],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["kotlin", kotlin],
  ["less", less],
  ["lua", lua],
  ["makefile", makefile],
  ["markdown", markdown],
  ["objectivec", objectivec],
  ["perl", perl],
  ["php", php],
  ["php-template", phpTemplate],
  ["plaintext", plaintext],
  ["powershell", powershell],
  ["python", python],
  ["python-repl", pythonRepl],
  ["r", r],
  ["ruby", ruby],
  ["rust", rust],
  ["scss", scss],
  ["shell", shell],
  ["sql", sql],
  ["swift", swift],
  ["typescript", typescript],
  ["vbnet", vbnet],
  ["wasm", wasm],
  ["xml", xml],
  ["yaml", yaml],
  ["latex", latex],
  ["mathematica", mathematica],
  ["matlab", matlab],
  ["nginx", nginx],
  ["pgsql", pgsql],
];

for (const [name, grammar] of languages) {
  hljs.registerLanguage(name, grammar);
}
hljs.registerAliases("wolfram", { languageName: "mathematica" });

export const CHAT_HIGHLIGHT_LANGUAGE_COUNT = languages.length;

export type HighlightedCode = {
  code: string;
  html: string;
  language?: string;
};

/**
 * Highlight a fenced block. Unknown explicit languages stay plain; untagged
 * blocks use the same bounded registered-language set for auto detection.
 */
export function highlightCode(
  code: string,
  requestedLanguage: string,
): HighlightedCode | null {
  if (requestedLanguage) {
    if (!hljs.getLanguage(requestedLanguage)) return null;
    const result = hljs.highlight(code, {
      language: requestedLanguage,
      ignoreIllegals: true,
    });
    return { code, html: result.value, language: result.language };
  }

  const result = hljs.highlightAuto(code, hljs.listLanguages());
  return { code, html: result.value, language: result.language };
}
