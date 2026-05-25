import express from "express";
import cors from "cors";
import dotenv from "dotenv";

const app = express();

const port = 3001;

app.use(express.json());
app.use(cors());

// inserir as rotas aqui
app.use()

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});