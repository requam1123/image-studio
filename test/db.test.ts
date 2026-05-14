import { describe, it, expect, beforeAll } from "vitest";
import { queryAll, queryOne, execute } from "@/lib/db";

describe("数据库操作", () => {
  beforeAll(() => {
    execute("DELETE FROM tasks WHERE username = ?", ["test-user"]);
    execute("DELETE FROM history WHERE username = ?", ["test-user"]);
  });

  describe("tasks 表", () => {
    const taskId = `task-test-${Date.now()}`;

    it("INSERT 一条任务并读取", () => {
      execute(
        `INSERT INTO tasks (id, username, type, prompt, count, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        [taskId, "test-user", "generate", "一只猫", 2, Date.now()]
      );

      const row = queryOne("SELECT * FROM tasks WHERE id = ?", [taskId]);
      expect(row).not.toBeNull();
      expect(row!.prompt).toBe("一只猫");
      expect(row!.type).toBe("generate");
      expect(row!.count).toBe(2);
      expect(row!.status).toBe("pending");
    });

    it("UPDATE 任务状态", () => {
      execute("UPDATE tasks SET status = ? WHERE id = ?", ["completed", taskId]);
      const row = queryOne("SELECT status FROM tasks WHERE id = ?", [taskId]);
      expect(row!.status).toBe("completed");
    });

    it("QUERY 按用户名过滤", () => {
      const rows = queryAll("SELECT * FROM tasks WHERE username = ?", ["test-user"]);
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("DELETE 任务", () => {
      execute("DELETE FROM tasks WHERE id = ?", [taskId]);
      const row = queryOne("SELECT * FROM tasks WHERE id = ?", [taskId]);
      expect(row).toBeNull();
    });
  });

  describe("tasks 表 - 多字段写入", () => {
    it("insert 含所有字段", () => {
      const id = `task-full-${Date.now()}`;
      execute(
        `INSERT INTO tasks (id, username, type, model, prompt, size, quality, count, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?)`,
        [id, "test-user", "edit", "gpt-image-2", "戴眼镜", "1024x1024", "high", 3, Date.now()]
      );

      const row = queryOne("SELECT * FROM tasks WHERE id = ?", [id]);
      expect(row!.type).toBe("edit");
      expect(row!.model).toBe("gpt-image-2");
      expect(row!.size).toBe("1024x1024");
      expect(row!.quality).toBe("high");
      expect(row!.count).toBe(3);
      expect(row!.status).toBe("processing");

      execute("DELETE FROM tasks WHERE id = ?", [id]);
    });
  });

  describe("history 表", () => {
    it("insert 并读取", () => {
      const id = `history-test-${Date.now()}`;
      execute(
        `INSERT INTO history (id, username, type, model, prompt, size, b64, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, "test-user", "generate", "gpt-image-2", "风景画", "1024x1024", "fakebase64", Date.now()]
      );

      const row = queryOne("SELECT * FROM history WHERE id = ?", [id]);
      expect(row).not.toBeNull();
      expect(row!.prompt).toBe("风景画");
      expect(row!.b64).toBe("fakebase64");

      execute("DELETE FROM history WHERE id = ?", [id]);
    });
  });
});
