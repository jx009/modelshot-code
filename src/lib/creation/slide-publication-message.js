export function slidePublishedMessage(outline, pageId, locale = "zh") {
  const index = outline.pages.findIndex(page => page.id === pageId), page = outline.pages[index];
  if (!page) return locale === "en" ? "A slide has been saved." : "页面已保存。";
  return locale === "en" ? 'Slide ' + (index + 1) + '/' + outline.pages.length + ' · ' + page.title + ' is saved. The presentation preview will update automatically.'
    : '第 ' + (index + 1) + '/' + outline.pages.length + ' 页「' + page.title + '」已生成并保存，右侧预览会自动更新。';
}
export function slideCompletionMessage(outline, locale = "zh") {
  const en = locale === "en", design = outline.design;
  return [en ? '“' + outline.title + '” is complete (' + outline.pages.length + ' slides). All pages are saved; you can browse, reorder, edit, present or export them.'
    : '「' + outline.title + '」演示文稿已完成，共 ' + outline.pages.length + ' 页，全部已保存。可在右侧浏览、调整顺序、编辑、演示或导出。',
  ...(design?.artDirection ? [(en ? '**Visual direction**\n' : '**视觉风格**\n') + design.artDirection] : []),
  en ? '**Slides**' : '**页面内容**',
  outline.pages.map((page, index) => (index + 1) + '. **' + page.title + '**' + (page.role ? ' — ' + page.role : '')).join('\n'),
  en ? 'Edits you made to completed slides have been preserved.' : '你对已完成页面的修改已保留。'].join('\n\n');
}
