#!/usr/bin/env python3
"""Build the three original KomaStudio artist mannequins as self-contained VRM 0.x.

No modelling tool, external art, or Python dependencies are needed. Ring lofts use
smooth skin weights; the Body stores five separate, local POSITION deltas.
"""
import json
import math as m
import struct as st
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'public' / 'figures'
SHAPES = ('bust', 'waist', 'hips', 'thighs', 'arms')
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')


def plus(a, b): return tuple(x+y for x, y in zip(a, b))
def minus(a, b): return tuple(x-y for x, y in zip(a, b))
def mul(a, s): return tuple(x*s for x in a)
def dot(a, b): return sum(x*y for x, y in zip(a, b))
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def unit(a): return mul(a, 1/(m.sqrt(dot(a, a)) or 1))
def mix(a, b, t): return plus(mul(a, 1-t), mul(b, t))
def lerp(a, b, t): return a+(b-a)*t

def smooth(t):
    t = min(1, max(0, t))
    return t*t*(3-2*t)


def skin_png():
    def chunk(kind, data): return st.pack('>I', len(data))+kind+data+st.pack('>I', zlib.crc32(kind+data))
    colors = b''.join(b'\0'+bytes(round(lerp(a,b,y/31)) for _ in range(16) for a,b in zip((254,244,240),(255,253,250))) for y in range(32))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', st.pack('>2I5B',16,32,8,2,0,0,0))+chunk(b'IDAT', zlib.compress(colors, 9))+chunk(b'IEND', b'')


class Mesh:
    def __init__(self):
        self.pos, self.uv, self.joints, self.weights, self.idx = [], [], [], [], []
        self.morphs = [[] for _ in SHAPES]

    def vert(self, p, weights, offsets=None):
        w = [*weights[:4], *([(0,0)]*4)][:4]
        self.pos.append(p)
        self.uv.append(((m.atan2(p[2], p[0])/m.tau+.5)%1, max(0,min(1, 1-p[1]/1.8))))
        self.joints.append(tuple(j for j,a in w)); self.weights.append(tuple(a for j,a in w))
        for out, value in zip(self.morphs, offsets or [(0,0,0)]*5): out.append(value)
        return len(self.pos)-1

    def loft(self, rings, sides, weights, delta=None, vertical=False):
        first = len(self.pos)
        for i, (c, rx, rz) in enumerate(rings):
            tangent = unit(minus(rings[min(len(rings)-1,i+1)][0],rings[max(0,i-1)][0]))
            # The U axis is chosen stably even for nearly horizontal fingers.
            u = (1,0,0) if vertical else unit(cross(tangent, (0,0,1)))
            v = (0,0,1) if vertical else cross(u, tangent)
            for j in range(sides):
                a = j*m.tau/sides
                local = plus(mul(u, rx*m.cos(a)),mul(v, rz*m.sin(a)))
                p = plus(c, local)
                offsets = delta(p, c, local, i) if delta else None
                self.vert(p, weights(p,i), offsets)
        for i in range(len(rings)-1):
            base = first+i*sides
            for j in range(sides):
                a=base+j; b=base+(j+1)%sides
                self.idx.extend((a,a+sides,b,b,a+sides,b+sides))
        # Close lofts, including fingers and heels. The end rings are small but not degenerate.
        a, b = first, first+(len(rings)-1)*sides
        start = self.vert(rings[0][0], weights(rings[0][0],0)); end = self.vert(rings[-1][0],weights(rings[-1][0],len(rings)-1))
        for j in range(sides):
            nxt = (j+1)%sides
            self.idx.extend((start,a+j,a+nxt,end,b+nxt,b+j))

    def normals(self):
        norm = [(0,0,0)]*len(self.pos)
        for k in range(0,len(self.idx),3):
            a,b,c = self.idx[k:k+3]
            n = cross(minus(self.pos[b], self.pos[a]), minus(self.pos[c], self.pos[a]))
            for i in (a,b,c): norm[i] = plus(norm[i], n)
        return [unit(n) for n in norm]


class VRM:
    def __init__(self):
        self.nodes = [{'name':'Koma figure','rotation':[0,1,0,0], 'children':[]}]
        self.bones, self.names, self.centers = [], {}, []
        self.bin = bytearray(); self.views = []; self.accessors = []

    def bone(self, name, parent, point):
        joint = len(self.bones); idx = len(self.nodes); self.bones.append(idx)
        self.names[name] = joint; self.centers.append(point)
        self.nodes.append({'name':name,'translation':minus(point,self.centers[self.names[parent]]) if parent else point,'children':[]})
        self.nodes[self.bones[self.names[parent]] if parent else 0]['children'].append(idx)
        return joint

    def view(self, data, tgt=None):
        self.bin.extend(b'\0'*((-len(self.bin))%4))
        view = {'buffer':0,'byteOffset':len(self.bin),'byteLength':len(data)}
        if tgt: view['target']=tgt
        self.bin.extend(data); self.views.append(view)
        return len(self.views)-1

    def accessor(self, rows, code, shape, target=None, extents=False):
        fmt, num = {'VEC2':('2',2),'VEC3':('3',3),'VEC4':('4',4),'MAT4':('16',16),'SCALAR':('',1)}[shape]
        out = bytearray()
        for row in rows: out.extend(st.pack('<'+fmt+code, *(row if num>1 else (row,))))
        entry = {'bufferView':self.view(out,target), 'componentType':{'f':5126,'H':5123,'I':5125}[code], 'count':len(rows),'type':shape}
        if extents: entry.update(min=[min(row[i] for row in rows) for i in range(num)],max=[max(row[i] for row in rows) for i in range(num)])
        self.accessors.append(entry)
        return len(self.accessors)-1

    def write(self, path, body, face, skin):
        materials = []
        for name, color in [('Seamless skin', skin), ('Iris',(.24,.13,.31)), ('Pearl',(.89,.83,.87)), ('Lid',(.11,.075,.125)),('Lip tint',(.57,.33,.36))]:
            props={'baseColorFactor':[*color,1], 'metallicFactor':0,'roughnessFactor':.78}
            if not materials: props['baseColorTexture']={'index':0}
            materials.append({'name':name,'pbrMetallicRoughness':props, 'doubleSided':False})
        meshes = []; skins=[]
        bind = self.accessor([(1,0,0,0, 0,1,0,0, 0,0,1,0, -x,-y,-z,1) for x,y,z in self.centers], 'f','MAT4')
        for name, primitive_info in [('Body', [(body,0)]), ('Face', list(zip(face,range(1,5))))]:
            primitives=[]
            for mesh, mat in primitive_info:
                attributes = dict(POSITION=self.accessor(mesh.pos,'f','VEC3',34962,True), NORMAL=self.accessor(mesh.normals(),'f','VEC3',34962), TEXCOORD_0=self.accessor(mesh.uv,'f','VEC2',34962),JOINTS_0=self.accessor(mesh.joints,'H','VEC4',34962), WEIGHTS_0=self.accessor(mesh.weights,'f','VEC4',34962))
                prim=dict(attributes=attributes,indices=self.accessor(mesh.idx,'H','SCALAR',34963),material=mat)
                if name=='Body': prim['targets']=[{'POSITION':self.accessor(rows,'f','VEC3',34962,True)} for rows in mesh.morphs]
                primitives.append(prim)
            obj={'name':name,'primitives':primitives}
            if name=='Body':obj.update(weights=[0]*5,extras={'targetNames':SHAPES})
            meshes.append(obj)
            self.nodes[0]['children'].append(len(self.nodes))
            self.nodes.append({'name':name,'mesh':len(meshes)-1,'skin':0})
        skins.append({'inverseBindMatrices':bind,'joints':self.bones,'skeleton':self.bones[0]})
        skin_tex=self.view(skin_png());
        humanoid=[{'bone':name,'node':self.bones[j],'useDefaultValues':True} for name,j in self.names.items()]
        vrm={'exporterVersion':'KomaStudio 1.0','specVersion':'0.0','humanoid':{'humanBones':humanoid,'armStretch':.05,'legStretch':.05,'upperArmTwist':.5,'lowerArmTwist':.5,'upperLegTwist':.5,'lowerLegTwist':.5}, 'meta':{'title':path.stem.replace('base_','Koma ').title(),'version':'1.0','author':'KomaStudio','allowedUserName':'Everyone','violentUssageName':'Disallow','sexualUssageName':'Disallow','commercialUssageName':'Allow','licenseName':'CC0'},'firstPerson':{'firstPersonBone':self.bones[self.names['head']],'firstPersonBoneOffset':{'x':0,'y':.04,'z':0}, **{key:{'curve':[0,0,0,1,1,1,1,0],'xRange':90,'yRange':10} for key in ('lookAtHorizontalInner','lookAtHorizontalOuter','lookAtVerticalDown','lookAtVerticalUp')}}, 'blendShapeMaster':{'blendShapeGroups':[]},'secondaryAnimation':{'boneGroups':[],'colliderGroups':[]},'materialProperties':[{'name':ma['name'],'shader':'VRM_USE_GLTFSHADER','renderQueue':2000,'floatProperties':{},'vectorProperties':{},'textureProperties':{},'keywordMap':{},'tagMap':{}} for ma in materials]}
        self.bin.extend(b'\0'*((-len(self.bin))%4))
        doc=dict(asset={'version':'2.0','generator':'KomaStudio figure generator'},extensionsUsed=['VRM'],extensions={'VRM':vrm},scene=0,scenes=[{'nodes':[0]}],nodes=self.nodes,meshes=meshes,skins=skins,materials=materials,images=[{'mimeType':'image/png','bufferView':skin_tex}],textures=[{'source':0}],buffers=[{'byteLength':len(self.bin)}],bufferViews=self.views,accessors=self.accessors)
        text=json.dumps(doc,separators=(',',':')).encode(); text+=b' '*((-len(text))%4)
        path.write_bytes(st.pack('<4sII',b'glTF',2,28+len(text)+len(self.bin))+st.pack('<I4s',len(text),b'JSON')+text+st.pack('<I4s',len(self.bin),b'BIN\0')+self.bin)
        print(f'{path.name}: {len(body.pos):,} vertices, {path.stat().st_size/1e6:.2f} MB')


def spans(rows, divisions):
    """Loft ring interpolation with smooth Catmull–Rom radii."""
    result=[]
    def cm(a,b,c,d,t): return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
    for i in range(len(rows)-1):
        a,b,c,d=[rows[min(len(rows)-1,max(0,j))] for j in (i-1,i,i+1,i+2)]
        for n in range(divisions):
            t=n/divisions
            result.append((mix(b[0],c[0],t),max(.0004,cm(a[1],b[1],c[1],d[1],t)),max(.0004,cm(a[2],b[2],c[2],d[2],t))))
    return result+[rows[-1]]


def make(kind, height, heads, broad, soft, chibi=False):
    vrm=VRM(); body=Mesh(); face=[Mesh() for _ in range(4)]; bone=vrm.bone
    z=0.; head_h=height/heads; chin=height-head_h; neck=chin-.019
    torso_scale=(chin-.02)/(1.68-1.68/6.8-.02); torso_width=(.87 if chibi else 1.)*broad
    y=lambda v:v*torso_scale
    hip_y=y(.908 if not chibi else .82); shoulder=y(1.359); chest_y=y(1.245); waist_y=y(1.072)
    hip_x=(.092 if not chibi else .085)*torso_width
    pelvis=bone('hips',None,(0,hip_y,z)); spine=bone('spine','hips',(0,waist_y,0)); chest=bone('chest','spine',(0,chest_y,-.007)); upper=bone('upperChest','chest',(0,shoulder-.04,-.003)); nk=bone('neck','upperChest',(0,neck,-.003)); head=bone('head','neck',(0,chin+.035,-.005))
    torso_rows=[(hip_y-y(.101),.024,.029,.008),(hip_y-y(.069),.091,.068,.002),(hip_y-y(.025),.142,.089,-.004),(hip_y+y(.025),.149,.089,-.003),(y(.986),.132,.079,-.004),(waist_y-y(.024),.118 if soft else .127,.073,-.006),(waist_y+y(.026),.118 if soft else .131,.074,-.008),(chest_y-y(.058),.143,.082,.001),(chest_y+y(.006),.162 if soft else .179,.094 if soft else .101,.006),(y(1.294),.166 if soft else .181,.084,-.003),(shoulder-y(.019),.169 if soft else .183,.067,-.006),(shoulder+y(.009),.139 if soft else .153,.054,-.006),(shoulder+y(.031),.067,.043,-.002),(neck+.005,.038,.036,-.004),(chin+.032,.040,.034,-.006)]
    torso_rows=[((0,h,zz*torso_width),rx*torso_width,rz*torso_width) for h,rx,rz,zz in sorted(torso_rows)]
    spline=[(hip_y,pelvis),(waist_y,spine),(chest_y,chest),(shoulder-.04,upper),(neck,nk),(chin+.035,head)]
    def body_weights(p, _):
        h=p[1]
        for (a,j),(b,k) in zip(spline,spline[1:]):
            if h<=b:
                t=smooth((h-a)/(b-a)); return [(j,1-t),(k,t)]
        return [(head,1)]
    def torso_delta(p,c,l,_):
        local=lambda cy,spread:m.exp(-((p[1]-cy)/spread)**2)
        fac=local(chest_y+.002,y(.096)); bust=(l[0]*fac*.11,0,l[2]*fac*(.48 if l[2]>0 else .11))
        waist=mul(l,local(waist_y,y(.102))*.23)
        hips=mul(l,local(hip_y+.014,y(.11))*.24)
        arm=(l[0]*local(shoulder,y(.055))*.09,0,l[2]*local(shoulder,y(.055))*.05)
        return bust,waist,hips,(0,0,0),arm
    body.loft(spans(torso_rows,3),40,body_weights,torso_delta,True)
    # Gently tapered, smooth anime-style face, inset eye decals and small ear shells.
    hw=head_h*(.39 if chibi else .352); hd=head_h*(.36 if chibi else .338)
    head_profile=[(0,.10,.22,.018),(.035,.37,.44,.030),(.12,.58,.64,.029),(.24,.79,.78,.014),(.39,.949,.906,.003),(.52,1,.97,-.004),(.66,1,1,-.008),(.77,.918,.952,-.009),(.89,.742,.79,-.008),(.965,.471,.53,-.007),(1,.018,.030,-.006)]
    skull_rows=[((0,chin+head_h*t,cz),hw*rx,hd*rz) for t,rx,rz,cz in head_profile]
    skull=spans(skull_rows,4)
    def face_z(x,h):
        for a,b in zip(skull,skull[1:]):
            if h<=b[0][1]:
                u=min(1,max(0,(h-a[0][1])/(b[0][1]-a[0][1]))); r=lerp(a[1],b[1],u); d=lerp(a[2],b[2],u)
                return lerp(a[0][2],b[0][2],u)+d*m.sqrt(max(.001,1-(x/r)**2))
        return 0
    def bump(x,h):
        return head_h*.048*m.exp(-((x/(hw*.21))**2+((h-chin-head_h*.395)/(head_h*.079))**2))
    skull_first=len(body.pos)
    body.loft(skull,44,lambda *_:[(head,1)],vertical=True)
    for idx,p in enumerate(body.pos[skull_first:]):
        if p[2]>0:body.pos[skull_first+idx]=(p[0],p[1],p[2]+bump(p[0],p[1]))
    def patch(mesh,cx,cy,rx,ry,tilt,offset,almond=False):
        def vert(x,h):return mesh.vert((x,h,face_z(x,h)+bump(x,h)+offset),[(head,1)])
        center=vert(cx,cy); segs=32; last=None
        for i in range(1,5):
            start=len(mesh.pos)
            for j in range(segs):
                a=j*m.tau/segs; dx=m.cos(a)*rx*i/4; dy=m.sin(a)*ry*i/4
                if almond: dy*=max(.4,1-abs(dx/rx)*.55)
                vert(cx+dx,cy+dy+dx*tilt)
            for j in range(segs):
                k=(j+1)%segs
                if last is None:mesh.idx.extend((center,start+j,start+k))
                else:mesh.idx.extend((last+j,start+j,start+k,last+j,start+k,last+k))
            last=start
    for side in [-1,1]:
        eh=chin+head_h*.512; ex=side*hw*.462
        patch(face[2],ex,eh+head_h*.005,hw*.342,head_h*(.077 if chibi else .059),side*.13,.0013,True)
        patch(face[1],ex,eh,hw*.314,head_h*(.065 if chibi else .047),side*.13,.0023,True)
        patch(face[0],ex-side*hw*.035,eh,hw*.111,head_h*(.047 if chibi else .041),0,.0035)
        patch(face[1],ex-hw*.046,eh+head_h*.018,hw*.035,head_h*.012,0,.0046)
        patch(face[2],side*hw*.45,eh+head_h*.117,hw*.30,head_h*.013,side*.12,.0012,True)
        earc=(side*hw*.929,chin+.379*head_h,-.005)
        ear=[((earc[0],earc[1]+.028*k*head_h/.246,earc[2]+.006*k),max(.0007,hw*.135*m.sqrt(max(0,1-k*k))),max(.0007,hd*.215*m.sqrt(max(0,1-k*k)))) for k in [-1,-.82,-.54,-.22,.1,.4,.72,.91,1]]
        body.loft(ear,16,lambda *_:[(head,1)],vertical=True)
    patch(face[3],0,chin+head_h*.233,hw*.168,head_h*.014,0,.0014,True)

    for side,prefix in [(1,'left'),(-1,'right')]:
        K=lambda s:prefix+s
        arm_h=(1.00 if not chibi else .87)*torso_scale
        sh=(side*(.152 if soft else .172)*torso_width,shoulder-y(.018),-.009)
        e=(sh[0]+side*.139*arm_h,sh[1]-.231*arm_h,-.012)
        hand=(e[0]+side*.109*arm_h,e[1]-.204*arm_h,.003)
        block=lambda j:[(j,1)]
        bone(K('Shoulder'),'upperChest',(side*.071*torso_width,shoulder-y(.013),-.012))
        a=bone(K('UpperArm'),K('Shoulder'),sh); b=bone(K('LowerArm'),K('UpperArm'),e); c=bone(K('Hand'),K('LowerArm'),hand)
        arm_dir=unit(minus(hand,e)); across=unit(cross(arm_dir,(0,0,1))); front=unit(cross(across,arm_dir))
        def limb(profile, js, points, radius, category, foot=None):
            # Sample profile coordinates across both segments without hard seams at joints.
            def at(t):
                if t<=.5: return mix(points[0],points[1],t*2)
                return mix(points[1],points[2],(t-.5)*2)
            rows=[(plus(at(t),(0,0,dz)),rx*radius,rz*radius) for t,rx,rz,dz in profile]
            if foot: rows.extend(foot)
            rings=spans(rows[::-1] if foot else rows,3)
            def weighted(p,i):
                j0,j1,j2=js; e=points[1][1]; w=points[2][1]; y=p[1]
                t1=smooth((e+.060*radius-y)/(.12*radius)); t2=smooth((w+.020*radius-y)/(.052*radius))
                toe_blend=smooth((p[2]-.075*torso_width)/(.055*torso_width)) if foot else 0
                out=[(j0,1-t1),(j1,t1*(1-t2)),(j2,t1*t2*(1-toe_blend))]
                if foot:out.append((toe,t1*t2*toe_blend))
                return out
            def delta(p,cent,local,i):
                h=p[1]; off=[(0,0,0)]*5
                if category=='arms':off[4]=mul(local,.30*m.exp(-((h-(points[0][1]+points[1][1])/2)/(.21*arm_h))**2))
                else:
                    t=m.exp(-((h-(points[0][1]+points[1][1])/2)/(.26*torso_scale))**2)
                    off[3]=mul(local,.31*t)
                    f=m.exp(-((h-points[0][1])/(.12*torso_scale))**2); off[2]=(f*(side*.025+local[0]*.11),0,local[2]*f*.13)
                return off
            body.loft(rings,28,weighted,delta,vertical=bool(foot))
        limb([(-.11,.012,.012,0),(-.062,.051,.048,0),(0,.064,.057,0),(.12,.064,.056,0),(.26,.054,.048,.004),(.42,.042,.040,0),(.50,.039,.042,-.001),(.59,.043,.042,.002),(.68,.041,.036,.003),(.83,.030,.028,.003),(.985,.023,.019,0),(1.07,.018,.014,0)],(a,b,c),(sh,e,hand),torso_width,'arms')
        palm_len=.080*arm_h; palm_w=.039*torso_width
        def hand_at(length,trans=0,depth=0):return plus(hand,plus(mul(arm_dir,length),plus(mul(across,trans),mul(front,depth))))
        body.loft(spans([(hand_at(palm_len*t),palm_w*w,palm_w*d) for t,w,d in [(-.15,.45,.36),(.1,.65,.48),(.35,.91,.48),(.71,1,.405),(.98,.91,.31),(1.12,.55,.21),(1.19,.04,.035)]],3),24,lambda *_:block(c))
        for fi,f in enumerate(FINGERS):
            if fi==0:
                base=hand_at(palm_len*.25, -side*palm_w*.60,.005); d=unit(plus(mul(arm_dir,.57),plus(mul(across,-side*.84),mul(front,.24)))); size=.064*arm_h; rad=.012*torso_width
            else:
                spread=[-.62,-.20,.23,.65][fi-1];base=hand_at(palm_len*(.97 if fi==4 else 1.03),side*palm_w*spread,.001)
                d=unit(plus(arm_dir,plus(mul(across,side*spread*.15),mul(front,.026))));size=[.076,.087,.078,.063][fi-1]*arm_h;rad=[.0111,.0117,.0102,.0091][fi-1]*torso_width
            k=f'{prefix}{f}'; p1=plus(base,mul(d,size*.40)); p2=plus(base,mul(d,size*.73)); tip=plus(base,mul(d,size))
            j1=bone(k+'Proximal',K('Hand'),base); j2=bone(k+'Intermediate',k+'Proximal',p1); j3=bone(k+'Distal',k+'Intermediate',p2)
            profile=[(-.16,.70),(-.03,1),(.16,.95),(.39,.87),(.49,.83),(.67,.75),(.76,.73),(.91,.63),(1,.31),(1.015,.055)]
            rows=[(plus(base,mul(d,size*t)),rad*r,rad*r*.87) for t,r in profile]
            def finger_weights(p,_):
                t=dot(minus(p,base),d)/size
                if t<.2:
                    v=smooth((t+.17)/.33);return [(c,1-v),(j1,v)]
                if t<.57:
                    v=smooth((t-.30)/.21);return [(j1,1-v),(j2,v)]
                v=smooth((t-.61)/.23);return [(j2,1-v),(j3,v)]
            body.loft(spans(rows,2),12,finger_weights)
        leg=(side*hip_x,hip_y,-.009); knee=(side*hip_x*1.19,y(.473 if not chibi else .45),.019); ankle=(side*hip_x*1.31,y(.088),.003)
        u=bone(K('UpperLeg'),'hips',leg); l=bone(K('LowerLeg'),K('UpperLeg'),knee); ft=bone(K('Foot'),K('LowerLeg'),ankle); toe=bone(K('Toes'),K('Foot'),(ankle[0]+side*.004,y(.035),.109*torso_width))
        footrows=[((ankle[0]+side*.004,y(h),dz*torso_width),rx*torso_width,rz*torso_width) for h,dz,rx,rz in [(.076,.020,.033,.051),(.060,.037,.040,.079),(.043,.054,.048,.097),(.027,.053,.047,.103),(.013,.050,.042,.097),(.008,.050,.035,.084),(.005,.048,.022,.055)]]
        limb([(-.12,.040,.044,-.005),(-.045,.077,.071,-.005),(.055,.085 if soft else .081,.078,-.009),(.15,.081,.075,-.010),(.28,.071,.066,-.005),(.41,.054,.054,.004),(.50,.046,.045,.006),(.59,.047,.054,-.004),(.68,.053,.054,-.013),(.79,.044,.049,-.011),(.91,.034,.034,-.004),(1,.030,.031,0)],(u,l,ft),(leg,knee,ankle),torso_width,'legs',footrows)

    vrm.write(OUT/f'base_{kind}.vrm',body,face, (.87,.585,.48) if soft else (.72,.515,.43))


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    make('female',1.68,6.8,1,True)
    make('male',1.77,7.2,1.10,False)
    make('chibi',1.24,2.8,1.04,True,True)
