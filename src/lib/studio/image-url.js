export const imageUrl = id => "/api/assets/" + id;
export const previewUrl = (id, size = 1280) => imageUrl(id) + "?preview=" + size;
