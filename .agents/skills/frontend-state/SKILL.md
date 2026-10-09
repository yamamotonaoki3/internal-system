---
name: frontend-state
description: 画面の状態・サーバーのデータ・フォームの扱い方のルール。データの取得と更新、操作結果の即時反映、フォームの入力チェックを扱うときに読む。
---

# 状態とフォーム（TanStack Query・React Hook Form・Zod）

作業の過程と結果は、すべて日本語で書く。

## サーバーのデータ（TanStack Query）

```ts
// features/recipes/api/query-keys.ts：クエリキーは機能ごとに1か所で定義する
export const recipeKeys = {
  all: ["recipes"] as const,
  detail: (id: number) => ["recipes", id] as const,
};

// 取得
const recipes = useQuery({ queryKey: recipeKeys.all, queryFn: fetchRecipes });

// 更新：成功したら関係するデータを取り直し、再読み込みせずに表示を最新にする（C-77）
const update = useMutation({
  mutationFn: updateRecipe,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: recipeKeys.all }),
});
```

- **MUST**：読み込み中・エラー・データなし・データありの4つを表示で分ける。取得に失敗したとき、データなしとして表示しない
- **MUST NOT**：サーバーのデータを`useState`やZustandにコピーしない
- **MUST**：更新の成功後に、関係するクエリキーを`invalidateQueries`で取り直す

## フォーム（React Hook Form＋Zod）

```ts
const schema = z.object({ title: z.string().min(1, "タイトルを入力してください") });
const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
```

- **MUST**：入力チェックのスキーマはZodで書く。共通のものは`schemas/`、1つの機能だけのものは`features/<機能>/`に置く
- **MUST**：送信中はボタンを押せなくし、多重送信を防ぐ
- **MUST**：サーバーから`VALIDATION_ERROR`の`fields`が返った場合は、該当する入力欄にエラーを表示する

## 画面の中だけの状態

- 1つの部品の中だけの状態は`useState`を使う
- 複数の画面で共有する、画面の中だけの状態が必要になった場合に限り、Zustandを承認を得て追加する

## 良い例・悪い例

例は、テスト（`frontend/src/rules-examples/server-state.test.tsx`・`form.test.tsx`）で動作を確かめてある。悪い例は、問題が起きることもテストで確かめてある。コードを書く前に読み、良い例の書き方に合わせる。

### サーバーのデータは`useQuery`の`data`をそのまま使う

#### 良い例

```ts
export function RecipeList() {
  const { data } = useQuery({
    queryKey: recipeKeys.all,
    queryFn: fetchRecipes,
  });
  // サーバーのデータは、useQuery の data をそのまま表示する（useState にコピーしない）
  return (
    <ul>
      {data?.map((recipe) => (
        <li key={recipe.id}>{recipe.title}</li>
      ))}
    </ul>
  );
}
```

#### 悪い例

```ts
export function RecipeListCopyBad() {
  const { data } = useQuery({
    queryKey: recipeKeys.all,
    queryFn: fetchRecipes,
  });
  return data ? <CopiedList initial={data} /> : null;
}

function CopiedList({ initial }: { initial: Recipe[] }) {
  // 悪い例：データを useState の初期値にコピーしている。取り直しても、表示は古いまま
  const [recipes] = useState(initial);
  return (
    <ul>
      {recipes.map((recipe) => (
        <li key={recipe.id}>{recipe.title}</li>
      ))}
    </ul>
  );
}
```

- 問題：`useState`にコピーすると、データが取り直されても、表示は古いまま残る

### 更新の後は、データを取り直す

#### 良い例

```ts
export function useAddRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addRecipe,
    // 更新が成功したら、関係するデータを取り直す（再読み込みせずに、表示が最新になる）
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: recipeKeys.all }),
  });
}
```

#### 悪い例

```ts
export function useAddRecipeBad() {
  // 悪い例：更新が成功しても、データを取り直さない。一覧は古いまま
  return useMutation({ mutationFn: addRecipe });
}
```

- 問題：更新が成功しても、一覧は古いまま。再読み込みするまで、変更が見えない

### 4つの状態（読み込み中・エラー・データなし・データあり）を表示し分ける

#### 良い例

```ts
export function RecipeListWithStates() {
  const { data, error, isPending } = useQuery({
    queryKey: recipeKeys.all,
    queryFn: fetchRecipes,
  });
  if (isPending) return <p>読み込み中です</p>;
  if (error) return <p role="alert">レシピを取得できませんでした</p>;
  if (data.length === 0) return <p>レシピはまだありません</p>;
  return (
    <ul>
      {data.map((recipe) => (
        <li key={recipe.id}>{recipe.title}</li>
      ))}
    </ul>
  );
}
```

#### 悪い例

```ts
export function RecipeListWithoutErrorBad() {
  const { data } = useQuery({
    queryKey: recipeKeys.all,
    queryFn: fetchRecipes,
  });
  // 悪い例：エラーの表示がない。取得に失敗しても、データなしと同じ画面になる
  return (
    <ul>
      {data?.map((recipe) => (
        <li key={recipe.id}>{recipe.title}</li>
      ))}
    </ul>
  );
}
```

- 問題：取得に失敗しても、エラーの表示が出ない。利用者には、失敗したのか、データがないのか分からない

### フォーム：サーバーの入力エラーは入力欄に出し、送信中は押せなくする

#### 良い例

```ts
export function RecipeForm() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Values) => {
    try {
      await postRecipe(values);
    } catch (e) {
      const error = e as ApiError;
      // サーバーが VALIDATION_ERROR で返した fields を、該当する入力欄のエラーにする
      if (error.code === "VALIDATION_ERROR") {
        const fields = error.fields?.filter((field) => field === "title") ?? [];
        const message = error.message || "入力内容を確かめてください";
        if (fields.length > 0) {
          fields.forEach((field) => setError(field, { message }));
        } else {
          setError("root.server", { message });
        }
      } else {
        setError("root.server", {
          message: "送信に失敗しました。時間をおいて、もう一度お試しください",
        });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>
        タイトル
        <input {...register("title")} aria-invalid={!!errors.title} />
      </label>
      {errors.title && <p role="alert">{errors.title.message}</p>}
      {errors.root?.server && <p role="alert">{errors.root.server.message}</p>}
      {/* 送信中は押せなくして、多重送信を防ぐ */}
      <button type="submit" disabled={isSubmitting}>
        登録
      </button>
    </form>
  );
}
```

- サーバーが`VALIDATION_ERROR`で返した`fields`は、`setError`で該当する入力欄のエラーにする
- 送信中（`isSubmitting`）は、送信のボタンを押せなくする

#### 悪い例

```ts
export function RecipeFormToastBad() {
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Values) => {
    try {
      await postRecipe(values);
    } catch {
      // 悪い例：全体のメッセージだけ。どの入力欄が誤りか、利用者に伝わらない
      setFailed(true);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>
        タイトル
        <input {...register("title")} aria-invalid={!!errors.title} />
      </label>
      {failed && <p role="status">登録に失敗しました</p>}
      <button type="submit" disabled={isSubmitting}>
        登録
      </button>
    </form>
  );
}
```

- 問題：全体のメッセージだけでは、どの入力欄が誤りか分からない

```ts
export function RecipeFormDoubleSubmitBad() {
  const { register, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
  });

  return (
    <form onSubmit={handleSubmit((values) => postRecipe(values))}>
      <label>
        タイトル
        <input {...register("title")} />
      </label>
      {/* 悪い例：送信中も押せる。続けて押すと、同じ内容が2回送られる */}
      <button type="submit">登録</button>
    </form>
  );
}
```

- 問題：送信中もボタンを押せると、続けて押したときに、同じ内容が2回送られる
