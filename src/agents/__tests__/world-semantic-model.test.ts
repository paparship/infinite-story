import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildWorldSemanticModel } from "../services/world-semantic-model";

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

describe("world-semantic-model", () => {
  it("extracts expected cgs from scripts", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "galagame-semantic-"));
    write(path.join(tmp, "chapter1.txt"), '@cg cg_ch1 "开场"');
    write(path.join(tmp, "route_a/chapter2.txt"), '@char 林夏 happy center\n@cg cg_ch2_a "二章A"');
    write(path.join(tmp, "route_a/chapter3.txt"), '@cg cg_ch3_a "三章A"');

    const model = buildWorldSemanticModel(tmp);
    expect(model.expectedCGs.map(c => c.id)).toEqual(["cg_ch1", "cg_ch2_a", "cg_ch3_a"]);
    expect(model.routeToCharacter.a).toBe("林夏");
  });
});

