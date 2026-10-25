-- =============================================================
-- 增量脚本：给访问记录加 IP，并新建带 IP 采集的写入函数
-- 在 Supabase → SQL Editor 执行一次即可（可重复执行）
-- =============================================================

alter table visits add column if not exists ip text;

-- 前端通过 RPC 写入，IP 由数据库从请求头取（前端伪造不了）
create or replace function log_visit(p_sid text, p_ua text, p_path text)
returns void
language plpgsql
security definer
as $$
declare
  hdr json;
  xff text;
begin
  begin
    hdr := current_setting('request.headers', true)::json;
  exception when others then
    hdr := null;
  end;

  xff := coalesce(hdr->>'x-forwarded-for', hdr->>'x-real-ip', '');

  insert into visits (sid, ua, path, ip)
  values (p_sid, p_ua, p_path, nullif(split_part(xff, ',', 1), ''));
end;
$$;

grant execute on function log_visit(text, text, text) to anon;
