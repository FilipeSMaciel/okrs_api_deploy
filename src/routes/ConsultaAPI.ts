import { Router } from "express";
import {z} from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();