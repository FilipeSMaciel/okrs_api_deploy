# Documentação do Schema - Recursos 1.3 e 1.4

## 1. User

**Propósito:** Armazenar usuários do sistema

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Identificador único |
| name | String | Nome do usuário |
| email | String | Email único |
| password | String | Senha (hash) |
| type | Enum | Tipo de acesso (ADMIN, USER) |
| createdAt | DateTime | Data de criação |
| updatedAt | DateTime | Última atualização |

---

## 2. Loja

**Propósito:** Armazenar informações das lojas da rede

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Identificador único |
| name | Enum | Nome da loja (LOJA1-LOJA5) |
| cnpj | String | CNPJ para chamadas à API ssOtica |
| metasFinanceiras | Relação | Link para KRs financeiros (R1.3) |
| metasOperacionais | Relação | Link para KRs operacionais (R1.4) |
| createdAt | DateTime | Data de criação |
| updatedAt | DateTime | Última atualização |

**Importante:**
- CNPJ é necessário para autenticar chamadas à API ssOtica
- Cada loja tem NO MÁXIMO uma `MetaFinanceira` e uma `MetaOperacional` por trimestre

---

## 3. MetaFinanceira (Recurso 1.3)

**Propósito:** Armazenar os 4 KRs financeiros do bloco "Prosperidade com Segurança"

### KR 1: Vendas em Cartão (%)
- `cartaoAtual`: Percentual atual (calculado)
- `cartaoMeta`: Meta definida pela gestão

### KR 2: Vendas à Vista (%)
- `avistaAtual`: Percentual atual (calculado)
- `avistaMeta`: Meta definida pela gestão

### KR 3: Ticket Médio (R$)
- `ticketAtual`: Valor atual em reais (calculado)
- `ticketMeta`: Meta em reais

### KR 4: Inadimplência (%)
- `inadimplenciaAtual`: Percentual atual (calculado) - **com defasagem de 3 meses**
- `inadimplenciaMeta`: Meta de limite máximo

**Defasagem de Inadimplência:**
- Maio/2026 → referência = fevereiro/2026
- Junho/2026 → referência = março/2026
- Julho/2026 → referência = abril/2026

### Rastreamento
- `lastCalculatedAt`: Timestamp da última execução do cálculo
- `calculationStatus`: Status (pending, success, error)
- `errorMessage`: Mensagem de erro (se houver)

### Relacionamentos
- `lojaId`: Referência à loja
- `trimestre`: Período (ex: "2T26")

**Índices:**
- Unique: `(lojaId, trimestre)` - garante uma meta por loja por trimestre

---

## 4. MetaOperacional (Recurso 1.4)

**Propósito:** Armazenar os 3 KRs operacionais do bloco "Operar com Excelência"

### KR 1: Garantias e Cancelamentos (%)
- `garantiasAtual`: Percentual atual (calculado)
- `garantiasMeta`: Meta máxima permitida

### KR 2: Vendas Luzter (%)
- `luzterAtual`: Percentual de lentes Luzter do total de lentes (calculado)
- `luzterMeta`: Meta de percentual mínimo

### KR 3: Vendas Binni (%)
- `binniAtual`: Percentual de lentes Binni do total de lentes (calculado)
- `binniMeta`: Meta de percentual mínimo

**Nota:** Luzter e Binni são filtrados por `produto.grife` no loop sobre `venda.itens[]`

### Rastreamento
- `lastCalculatedAt`: Timestamp da última execução do cálculo
- `calculationStatus`: Status (pending, success, error)
- `errorMessage`: Mensagem de erro (se houver)

### Relacionamentos
- `lojaId`: Referência à loja
- `trimestre`: Período (ex: "2T26")

**Índices:**
- Unique: `(lojaId, trimestre)` - garante uma meta por loja por trimestre

---

## 5. Fluxo de Dados

### Ao abrir o painel:

```
1. Frontend identifica lojaId do usuário
2. Backend busca MetaFinanceira (loja, trimestre)
3. Backend busca MetaOperacional (loja, trimestre)
4. Se lastCalculatedAt < 5 minutos: exibe dados cached
5. Se lastCalculatedAt > 5 minutos: executa cálculos via API ssOtica + ClickUp
6. Atualiza MetaFinanceira e MetaOperacional com novos valores
7. Seta lastCalculatedAt = now()
8. Frontend exibe painel com timestamp
```

### Se cálculo falhar:

```
1. calculationStatus = "error"
2. errorMessage = descrição do erro
3. Frontend exibe dados anteriores com aviso "dados podem estar desatualizados"
4. Próxima abertura da página tenta novamente
```

---

## 6. Queries Comuns

### Buscar KRs atuais de uma loja

```prisma
const meta = await prisma.metaFinanceira.findUnique({
  where: { lojaId_trimestre: { lojaId: "loja-1", trimestre: "2T26" } }
});
```

### Criar/atualizar KRs após cálculo

```prisma
const meta = await prisma.metaFinanceira.upsert({
  where: { lojaId_trimestre: { lojaId: "loja-1", trimestre: "2T26" } },
  create: {
    lojaId: "loja-1",
    trimestre: "2T26",
    cartaoAtual: 36.5,
    cartaoMeta: 35,
    // ... outros KRs
    lastCalculatedAt: new Date(),
    calculationStatus: "success",
  },
  update: {
    cartaoAtual: 36.5,
    avistaAtual: 22.3,
    ticketAtual: new Decimal("487.50"),
    inadimplenciaAtual: 4.2,
    lastCalculatedAt: new Date(),
    calculationStatus: "success",
    errorMessage: null,
  },
});
```

### Registrar erro de cálculo

```prisma
const meta = await prisma.metaFinanceira.update({
  where: { lojaId_trimestre: { lojaId: "loja-1", trimestre: "2T26" } },
  data: {
    calculationStatus: "error",
    errorMessage: "API ssOtica retornou status 500",
    lastCalculatedAt: new Date(),
  },
});
```

---

## 7. Valores NULL

Todos os campos `*Atual` (valores calculados) são `Float?` ou `Decimal?`, ou seja, **podem ser NULL**:

- Se API falhar → todos os `*Atual` viram NULL
- Se denominador = 0 (ex: zero vendas) → campo exibe "-" no painel
- Se cálculo bem-sucedido → campo tem um valor

**Frontend deve tratar NULL como "-" (travessão)**

---

## 8. Trimestres

Format: `"2T26"`, `"3T26"`, etc (sem espaços)

- 2T26 = 2º trimestre 2026 (abril, maio, junho)
- 3T26 = 3º trimestre 2026 (julho, agosto, setembro)

---

## 9. Performance

**Índices definidos:**
- `MetaFinanceira`: index `(lojaId, trimestre)` - queries por loja + período são rápidas
- `MetaOperacional`: index `(lojaId, trimestre)` - idem

**Constraint única:**
- Impossível ter dois registros com mesma `(lojaId, trimestre)` - garante integridade

---

## 10. Migração do Seu Schema Anterior

**Seu schema anterior tinha:**
- `MetaFinanceira` com 6 campos (cartão, avista, ticket, meta de inadimplência)

**Novo schema adiciona:**
- `inadimplenciaAtual` - o valor atual que estava faltando
- `lastCalculatedAt`, `calculationStatus`, `errorMessage` - rastreamento de cálculos
- `MetaOperacional` - tabela inteira com 6 campos (3 KRs + 3 rastreamento)

**Migração:**
```bash
npx prisma migrate dev --name add_r1_3_r1_4_fields
```

Isso vai:
1. Adicionar os novos campos a `MetaFinanceira`
2. Criar a tabela `MetaOperacional`
3. Gerar o Prisma Client atualizado
