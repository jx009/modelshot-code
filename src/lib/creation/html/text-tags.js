export const inlineTextTags = new Set('span b strong i em u s strike br small sub sup mark a code'.split(' '));
export const textRootTags = new Set([...inlineTextTags, ...'p div h1 h2 h3 h4 h5 h6 li blockquote figcaption address dt dd label caption td th'.split(' ')]);
