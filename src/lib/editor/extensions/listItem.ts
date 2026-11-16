import { ListItem as BaseListItem } from "@tiptap/extension-list";

// The block types a list item may start with. The stock schema demands a
// paragraph first ("paragraph block*"), and the image is a block node, so an
// image inserted into an empty bullet or checkbox could never sit on the
// marker's line: ProseMirror refilled the item with an empty paragraph above
// it. That empty line had to be removed by hand, and it was saved as "- "
// followed by a blank line, which CommonMark reads back as an empty item with
// the image *outside* the list. With the image allowed as the lead block the
// item holds just the image and is written as "- ![alt](src)".
//
// A group rather than "(paragraph | image)" because the image node is not part
// of every schema built from these extensions (the AI preview has none), and
// a content expression naming a missing type does not compile. The paragraph
// stays the first member, so an item ProseMirror creates on its own (Enter,
// createAndFill) is still a paragraph.
export const LIST_ITEM_LEAD_GROUP = "listItemLead";
export const LIST_ITEM_CONTENT = `${LIST_ITEM_LEAD_GROUP} block*`;

export const ListItem = BaseListItem.extend({
  content: LIST_ITEM_CONTENT
});
