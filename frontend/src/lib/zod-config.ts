// 本番の CSP は eval を禁止するため、zod が起動時に行う eval の試し（JIT）を省く。zod を使うモジュールより先に読み込むこと。
import { z } from "zod";

z.config({ jitless: true });
