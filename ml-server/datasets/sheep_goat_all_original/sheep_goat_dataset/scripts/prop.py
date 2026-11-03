import cv2,numpy as np,sys
sys.path.insert(0,'.'); import ann
A=ann.A; W,H=1280,720
g={k:cv2.GaussianBlur(cv2.imread(f'ds/images/frame_{k:04d}.jpg',0),(3,3),0) for k in range(1,108)}
def step(boxes,src,dst,pad=70,thr=0.45):
    out=[]
    for c,x,y,w,h in boxes:
        x0,y0=max(0,x),max(0,y); x1,y1=min(W,x+w),min(H,y+h)
        if x1-x0<20 or y1-y0<20: continue
        t=g[src][y0:y1,x0:x1]
        sx0,sy0=max(0,x0-pad),max(0,y0-pad); sx1,sy1=min(W,x1+pad),min(H,y1+pad)
        s=g[dst][sy0:sy1,sx0:sx1]
        if s.shape[0]<t.shape[0] or s.shape[1]<t.shape[1]: continue
        r=cv2.matchTemplate(s,t,cv2.TM_CCOEFF_NORMED)
        _,mx,_,loc=cv2.minMaxLoc(r)
        if mx<thr: continue
        nx,ny=sx0+loc[0],sy0+loc[1]
        out.append((c,nx-(x0-x),ny-(y0-y),w,h))
    return out
seeds=sorted(A)
res={k:list(v) for k,v in A.items()}
src_of={}
for k in range(1,108):
    if k in A: continue
    # nearest seed
    s=min(seeds,key=lambda a:abs(a-k)); src_of[k]=s
# chain outward from each seed
for s in seeds:
    for d in (1,-1):
        cur=A[s]; prev=s; k=s+d
        while 1<=k<=107 and k not in A and src_of.get(k)==s:
            cur=step(cur,prev,k); res[k]=cur; prev=k; k+=d
import pickle; pickle.dump(res,open('prop.pkl','wb'))
print(sum(len(v) for v in res.values()), len(res))
# montages
names=['sheep','goat']
def draw(k):
    v=cv2.imread(f'ds/images/frame_{k:04d}.jpg')
    for c,x,y,w,h in res[k]:
        col=(0,255,0) if c==0 else (0,0,255)
        cv2.rectangle(v,(x,y),(x+w,y+h),col,3)
    cv2.putText(v,f'#{k}',(900,60),0,2,(0,255,255),4)
    return cv2.resize(v,(640,360))
ks=sorted(res)
for i in range(0,len(ks),6):
    ims=[draw(k) for k in ks[i:i+6]]
    while len(ims)<6: ims.append(np.zeros_like(ims[0]))
    cv2.imwrite(f'rev_{i//6:02d}.jpg',np.vstack([np.hstack(ims[0:2]),np.hstack(ims[2:4]),np.hstack(ims[4:6])]))
print(len(ks)//6+1)
