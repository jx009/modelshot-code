-- 网页创作类型已下线：移除公开站点发布相关表。子表先删，外键随表一并删除。
DROP TABLE IF EXISTS "WebPublicationCommand";
DROP TABLE IF EXISTS "WebPublicationRevision";
DROP TABLE IF EXISTS "WebPublication";
